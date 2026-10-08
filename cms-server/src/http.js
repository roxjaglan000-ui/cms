import { createServer } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from './db.js';
import { config } from './config.js';
import { bus, logEvent } from './service.js';
import { ALARMS } from './telemetry.js';

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

// Dashboard se panel ko bhejne layak commands (firmware ke RPC methods)
const ALLOWED_RPC = new Set(['setLight', 'setMode', 'setSchedule', 'setAstro', 'setSpecial',
  'learnBaseline', 'setInterval', 'setLimits', 'setLampW', 'setLocation', 'getStatus']);

export async function startHttp(broker, log = console) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  function auth(minRole = 'viewer') {
    return (req, res, next) => {
      const h = req.get('authorization') || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
      try {
        req.user = jwt.verify(String(token || ''), config.jwtSecret);
      } catch {
        return res.status(401).json({ error: 'Login required' });
      }
      if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
        return res.status(403).json({ error: 'Not allowed for your role' });
      }
      next();
    };
  }

  const panelId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Bad panel id'), { status: 400 });
    return id;
  };

  function range(req, defaultHours = 24) {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to - defaultHours * 3600e3);
    if (Number.isNaN(+from) || Number.isNaN(+to) || from >= to) {
      throw Object.assign(new Error('Bad from/to'), { status: 400 });
    }
    return { from, to };
  }

  // ---------- auth ----------
  app.post('/api/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const { rows } = await q('SELECT * FROM users WHERE username = $1', [String(username || '')]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
      return res.status(401).json({ error: 'Galat username ya password' });
    }
    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role },
      config.jwtSecret, { expiresIn: '12h' });
    await logEvent(null, 'user', 'Login', user.username);
    res.json({ token, user: { username: user.username, role: user.role } });
  }));

  app.post('/api/me/password', auth(), wrap(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'Password kam se kam 8 characters' });
    const { rows } = await q('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
    if (!rows[0] || !(await bcrypt.compare(String(oldPassword || ''), rows[0].password_hash))) {
      return res.status(400).json({ error: 'Purana password galat hai' });
    }
    await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.sub, await bcrypt.hash(newPassword, 10)]);
    res.json({ ok: true });
  }));

  app.get('/api/users', auth('admin'), wrap(async (req, res) => {
    const { rows } = await q('SELECT id, username, role, created_at FROM users ORDER BY id');
    res.json(rows);
  }));

  app.post('/api/users', auth('admin'), wrap(async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username || '') || String(password || '').length < 8 || !ROLE_RANK[role]) {
      return res.status(400).json({ error: 'username (3-32), password (8+) aur role (admin/operator/viewer) do' });
    }
    const { rows } = await q(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING RETURNING id, username, role`,
      [username, await bcrypt.hash(password, 10), role]);
    if (!rows[0]) return res.status(409).json({ error: 'Ye username pehle se hai' });
    await logEvent(null, 'user', `User created: ${username} (${role})`, req.user.username);
    res.status(201).json(rows[0]);
  }));

  // ---------- dashboard ----------
  app.get('/api/meta', auth(), (req, res) => res.json({ alarms: ALARMS, user: req.user }));

  app.get('/api/summary', auth(), wrap(async (req, res) => {
    const { rows: [p] } = await q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE online)::int AS online,
              count(*) FILTER (WHERE online AND (latest->>'light')::boolean)::int AS lights_on,
              coalesce(sum((latest->>'kwTotal')::float) FILTER (WHERE online), 0) AS kw_now,
              coalesce(sum(poles), 0)::int AS poles
       FROM panels`);
    const { rows: a } = await q(
      `SELECT severity, count(*)::int AS n FROM alarms WHERE cleared_at IS NULL GROUP BY severity`);
    const { rows: [e] } = await q(
      `SELECT coalesce(sum(d), 0) AS kwh_today FROM (
         SELECT max(kwh) - min(kwh) AS d FROM telemetry
         WHERE ts >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
         GROUP BY panel_id) x`, [config.timezone]);
    res.json({ ...p, kwh_today: Number(e.kwh_today),
      alarms: Object.fromEntries(a.map((r) => [r.severity, r.n])) });
  }));

  app.get('/api/panels', auth(), wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT p.id, p.device_name, p.name, p.zone, p.lat, p.lon, p.poles, p.lamp_w, p.online,
              p.last_seen, p.latest, p.latest_ts,
              coalesce(a.n, 0)::int AS active_alarms, a.worst
       FROM panels p
       LEFT JOIN LATERAL (
         SELECT count(*) AS n,
                min(CASE severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END) AS worst
         FROM alarms WHERE panel_id = p.id AND cleared_at IS NULL) a ON true
       ORDER BY p.name NULLS LAST, p.id`);
    res.json(rows.map((r) => ({ ...r, connected: broker.isConnected(r.id) })));
  }));

  app.get('/api/panels/:id', auth(), wrap(async (req, res) => {
    const id = panelId(req);
    const { rows } = await q('SELECT * FROM panels WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Panel not found' });
    const { token, ...panel } = rows[0];
    res.json({ ...panel, connected: broker.isConnected(id) });
  }));

  app.patch('/api/panels/:id', auth('admin'), wrap(async (req, res) => {
    const id = panelId(req);
    const b = req.body || {};
    const fields = { name: 'text', zone: 'text', lat: 'num', lon: 'num', poles: 'int', lamp_w: 'num' };
    const sets = [], vals = [id];
    for (const [k, type] of Object.entries(fields)) {
      if (!(k in b)) continue;
      let v = b[k];
      if (v === '' || v === null) v = null;
      else if (type !== 'text') {
        v = Number(v);
        if (!Number.isFinite(v) || (type === 'int' && !Number.isInteger(v))) {
          return res.status(400).json({ error: `Bad ${k}` });
        }
      } else v = String(v).slice(0, 100);
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await q(`UPDATE panels SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: 'Panel not found' });
    await logEvent(id, 'user', `Panel details updated: ${Object.keys(b).filter((k) => k in fields).join(', ')}`, req.user.username);
    // Location badli to panel ko bhi bata do (ASTRO sunrise/sunset ke liye)
    const p = rows[0];
    if (('lat' in b || 'lon' in b) && p.lat != null && p.lon != null && broker.isConnected(id)) {
      broker.rpc(id, 'setLocation', { lat: p.lat, lon: p.lon }, req.user.username).catch(() => {});
    }
    const { token, ...panel } = p;
    res.json(panel);
  }));

  app.post('/api/panels/:id/rpc', auth('operator'), wrap(async (req, res) => {
    const id = panelId(req);
    const { method, params } = req.body || {};
    if (!ALLOWED_RPC.has(method)) return res.status(400).json({ error: 'Unknown command' });
    const result = await broker.rpc(id, method, params, req.user.username);
    res.json(result);
  }));

  // History: lambi range ho to average karke ~500 points
  app.get('/api/panels/:id/telemetry', auth(), wrap(async (req, res) => {
    const id = panelId(req);
    const { from, to } = range(req);
    const bucketSec = Math.max(300, Math.ceil((to - from) / 1000 / 500));
    const { rows } = await q(
      `SELECT date_bin(make_interval(secs => $4), ts, TIMESTAMPTZ '2000-01-01') AS ts,
              avg(v_r) AS v_r, avg(v_y) AS v_y, avg(v_b) AS v_b,
              avg(i_r) AS i_r, avg(i_y) AS i_y, avg(i_b) AS i_b,
              avg(kw_total) AS kw_total, max(kwh) AS kwh, bool_or(light) AS light
       FROM telemetry WHERE panel_id = $1 AND ts >= $2 AND ts < $3
       GROUP BY 1 ORDER BY 1`, [id, from, to, bucketSec]);
    res.json(rows);
  }));

  // Roz ka kWh (IST din ke hisaab se)
  app.get('/api/panels/:id/energy', auth(), wrap(async (req, res) => {
    const id = panelId(req);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 366);
    res.json(await dailyEnergy(id, days));
  }));

  app.get('/api/energy', auth(), wrap(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 366);
    res.json(await dailyEnergy(null, days));
  }));

  async function dailyEnergy(id, days) {
    const { rows } = await q(
      `SELECT day::text, sum(kwh)::float AS kwh FROM (
         SELECT panel_id, (ts AT TIME ZONE $3)::date AS day, max(kwh) - min(kwh) AS kwh
         FROM telemetry
         WHERE ($1::int IS NULL OR panel_id = $1)
           AND ts >= (date_trunc('day', now() AT TIME ZONE $3) - make_interval(days => $2 - 1)) AT TIME ZONE $3
         GROUP BY 1, 2) x
       GROUP BY day ORDER BY day`, [id, days, config.timezone]);
    return rows;
  }

  app.get('/api/alarms', auth(), wrap(async (req, res) => {
    const active = req.query.active === '1';
    const pid = req.query.panel ? Number(req.query.panel) : null;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await q(
      `SELECT a.*, p.name AS panel_name FROM alarms a JOIN panels p ON p.id = a.panel_id
       WHERE ($1::boolean IS NOT TRUE OR a.cleared_at IS NULL)
         AND ($2::int IS NULL OR a.panel_id = $2)
       ORDER BY a.cleared_at IS NULL DESC, a.raised_at DESC LIMIT $3`, [active, pid, limit]);
    res.json(rows);
  }));

  app.post('/api/alarms/:id/ack', auth('operator'), wrap(async (req, res) => {
    const { rows } = await q(
      `UPDATE alarms SET acked_at = now(), acked_by = $2 WHERE id = $1 AND acked_at IS NULL RETURNING *`,
      [Number(req.params.id), req.user.username]);
    if (!rows[0]) return res.status(404).json({ error: 'Alarm not found or already acknowledged' });
    await logEvent(rows[0].panel_id, 'user', `Alarm acknowledged: ${ALARMS[rows[0].code]?.label || rows[0].code}`, req.user.username);
    bus.emit('alarm', rows[0]);
    res.json(rows[0]);
  }));

  app.get('/api/events', auth(), wrap(async (req, res) => {
    const pid = req.query.panel ? Number(req.query.panel) : null;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await q(
      `SELECT e.*, p.name AS panel_name FROM events e LEFT JOIN panels p ON p.id = e.panel_id
       WHERE ($1::int IS NULL OR e.panel_id = $1) ORDER BY e.ts DESC, e.id DESC LIMIT $2`, [pid, limit]);
    res.json(rows);
  }));

  // Excel me khulne wala CSV (raw 5-min data)
  app.get('/api/panels/:id/export.csv', auth(), wrap(async (req, res) => {
    const id = panelId(req);
    const { from, to } = range(req, 24 * 7);
    const cols = ['ts', 'v_r', 'v_y', 'v_b', 'i_r', 'i_y', 'i_b', 'kw_r', 'kw_y', 'kw_b',
      'pf_r', 'pf_y', 'pf_b', 'kw_total', 'kwh', 'freq', 'light', 'rssi', 'faults'];
    const { rows } = await q(
      `SELECT ${cols.join(', ')} FROM telemetry WHERE panel_id = $1 AND ts >= $2 AND ts < $3
       ORDER BY ts LIMIT 200000`, [id, from, to]);
    const cell = (v) => {
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return `"${v.join(' ')}"`;
      return v ?? '';
    };
    res.set('content-type', 'text/csv; charset=utf-8');
    res.set('content-disposition', `attachment; filename="panel-${id}.csv"`);
    res.send([cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'));
  }));

  // Live updates (Server-Sent Events)
  app.get('/api/stream', auth(), (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.flushHeaders();
    const send = (type) => (data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const onPanel = send('panel'), onAlarm = send('alarm');
    bus.on('panel', onPanel);
    bus.on('alarm', onAlarm);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      bus.off('panel', onPanel);
      bus.off('alarm', onAlarm);
    });
  });

  app.get('/healthz', (req, res) => res.json({ ok: true, mqttClients: broker.connectedCount() }));

  // Libraries apne server se (CDN/internet pe depend nahi, sirf map tiles ke liye internet chahiye)
  const nm = (p) => new URL(`../node_modules/${p}`, import.meta.url).pathname;
  app.use('/vendor/leaflet', express.static(nm('leaflet/dist')));
  app.use('/vendor/chart.js', express.static(nm('chart.js/dist')));
  app.use(express.static(new URL('../public', import.meta.url).pathname));

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) log.error?.(err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
  });

  const server = createServer(app);
  await new Promise((resolve) => server.listen(config.httpPort, resolve));
  log.info?.(`Dashboard on http://localhost:${server.address().port}`);
  return {
    port: () => server.address().port,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
