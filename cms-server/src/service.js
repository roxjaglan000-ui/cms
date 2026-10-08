import { EventEmitter } from 'node:events';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import { ALARMS, normalizeTelemetry, parseFaultEvent, isSnapshot, toTelemetryRow } from './telemetry.js';

// Dashboard live update ke liye (SSE). Events: 'panel', 'alarm'
export const bus = new EventEmitter();
bus.setMaxListeners(1000);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Firmware pehli baar online aata hai to apna token yahan se leta hai.
// Same device dobara aaye (flash reset) to wahi purana token milta hai.
export async function provisionDevice({ deviceName, provisionDeviceKey, provisionDeviceSecret }) {
  if (!safeEqual(provisionDeviceKey || '', config.provisionKey) ||
      !safeEqual(provisionDeviceSecret || '', config.provisionSecret)) {
    return { status: 'FAILURE', errorMsg: 'Bad provision key/secret' };
  }
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(deviceName || '')) {
    return { status: 'FAILURE', errorMsg: 'Bad deviceName' };
  }
  const existing = await q('SELECT token FROM panels WHERE device_name = $1', [deviceName]);
  if (existing.rows[0]) {
    return { status: 'SUCCESS', credentialsType: 'ACCESS_TOKEN', credentialsValue: existing.rows[0].token };
  }
  const token = randomBytes(15).toString('hex');
  const { rows } = await q(
    `INSERT INTO panels (device_name, token, name) VALUES ($1, $2, $1)
     ON CONFLICT (device_name) DO UPDATE SET device_name = EXCLUDED.device_name
     RETURNING id, token, (xmax = 0) AS created`,
    [deviceName, token]);
  if (rows[0].created) {
    await logEvent(rows[0].id, 'system', `New panel registered: ${deviceName}`);
  }
  return { status: 'SUCCESS', credentialsType: 'ACCESS_TOKEN', credentialsValue: rows[0].token };
}

export async function findPanelByToken(token) {
  if (!token) return null;
  const { rows } = await q('SELECT id, device_name FROM panels WHERE token = $1', [token]);
  return rows[0] || null;
}

export async function logEvent(panelId, type, message, username = null, ts = new Date()) {
  await q('INSERT INTO events (panel_id, ts, type, message, username) VALUES ($1, $2, $3, $4, $5)',
    [panelId, ts, type, message, username]);
}

export async function raiseAlarm(panelId, code, ts = new Date()) {
  const meta = ALARMS[code];
  const { rows } = await q(
    `INSERT INTO alarms (panel_id, code, severity, raised_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (panel_id, code) WHERE cleared_at IS NULL DO NOTHING
     RETURNING *`,
    [panelId, code, meta.severity, ts]);
  if (rows[0]) {
    await logEvent(panelId, 'fault', `${meta.label} RAISED`, null, ts);
    bus.emit('alarm', rows[0]);
  }
  return rows[0] || null;
}

export async function clearAlarm(panelId, code, ts = new Date()) {
  const { rows } = await q(
    `UPDATE alarms SET cleared_at = GREATEST($3::timestamptz, raised_at)
     WHERE panel_id = $1 AND code = $2 AND cleared_at IS NULL RETURNING *`,
    [panelId, code, ts]);
  if (rows[0]) {
    await logEvent(panelId, 'fault', `${ALARMS[code].label} CLEARED`, null, ts);
    bus.emit('alarm', rows[0]);
  }
  return rows[0] || null;
}

// Panel se aaya har telemetry message yahan aata hai.
export async function ingest(panelId, payload, now = Date.now()) {
  const items = normalizeTelemetry(payload, now);
  await markOnline(panelId, new Date(now));
  for (const { ts, values } of items) {
    const at = new Date(ts);
    if (values.event) {
      const ev = parseFaultEvent(values.event);
      if (ev) await (ev.raised ? raiseAlarm(panelId, ev.code, at) : clearAlarm(panelId, ev.code, at));
      else await logEvent(panelId, 'system', String(values.event).slice(0, 200), null, at);
      continue;
    }
    if (!isSnapshot(values)) continue;
    const row = toTelemetryRow(values);
    await q(
      `INSERT INTO telemetry (panel_id, ts, v_r, v_y, v_b, i_r, i_y, i_b, kw_r, kw_y, kw_b,
         pf_r, pf_y, pf_b, kw_total, kwh, freq, light, rssi, faults, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (panel_id, ts) DO NOTHING`,
      [panelId, at, row.v_r, row.v_y, row.v_b, row.i_r, row.i_y, row.i_b, row.kw_r, row.kw_y,
        row.kw_b, row.pf_r, row.pf_y, row.pf_b, row.kw_total, row.kwh, row.freq, row.light,
        row.rssi, row.faults, values]);
    // Offline queue ka purana data "latest" ko overwrite na kare
    const { rows } = await q(
      `UPDATE panels SET latest = $2, latest_ts = $3
       WHERE id = $1 AND (latest_ts IS NULL OR latest_ts <= $3) RETURNING id`,
      [panelId, values, at]);
    if (rows[0]) {
      // GPS wala panel (ya simulator) location bheje aur CMS me abhi set na ho to wahi le lo
      if (typeof values.lat === 'number' && typeof values.lon === 'number') {
        await q('UPDATE panels SET lat = $2, lon = $3 WHERE id = $1 AND lat IS NULL',
          [panelId, values.lat, values.lon]);
      }
      await reconcileFaults(panelId, row.faults, at);
      bus.emit('panel', { id: panelId, latest: values, latest_ts: at });
    }
  }
}

// Snapshot ke fault flags hi sach hain: koi RAISED/CLEARED event miss hua ho to bhi alarm sahi rahe
async function reconcileFaults(panelId, faults, ts) {
  const { rows } = await q(
    `SELECT code FROM alarms WHERE panel_id = $1 AND cleared_at IS NULL AND code LIKE 'f\\_%'`,
    [panelId]);
  const open = new Set(rows.map((r) => r.code));
  for (const code of faults) if (!open.has(code)) await raiseAlarm(panelId, code, ts);
  for (const code of open) if (!faults.includes(code)) await clearAlarm(panelId, code, ts);
}

async function markOnline(panelId, at) {
  const { rows } = await q(
    `UPDATE panels p SET last_seen = $2, online = true
     FROM (SELECT online FROM panels WHERE id = $1) old
     WHERE p.id = $1 RETURNING old.online AS was_online`,
    [panelId, at]);
  if (rows[0] && !rows[0].was_online) {
    await clearAlarm(panelId, 'offline', at);
    bus.emit('panel', { id: panelId, online: true, last_seen: at });
  }
}

// Har minute: jin panels ka data OFFLINE_AFTER_MIN se nahi aaya unhe offline karo
export async function sweepOffline(now = new Date()) {
  const { rows } = await q(
    `UPDATE panels SET online = false
     WHERE online AND last_seen < $1::timestamptz - make_interval(mins => $2)
     RETURNING id, last_seen`,
    [now, config.offlineAfterMin]);
  for (const p of rows) {
    await raiseAlarm(p.id, 'offline', now);
    bus.emit('panel', { id: p.id, online: false, last_seen: p.last_seen });
  }
  return rows.length;
}
