// End-to-end: asli MQTT client (firmware jaisa) + PostgreSQL.
// Chalane ke liye: TEST_DATABASE_URL=postgres://.../cms_test npm test   (DB ka data mit jayega)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mqtt from 'mqtt';

const DB = process.env.TEST_DATABASE_URL;
const skip = DB ? false : 'set TEST_DATABASE_URL to run';

let app, pool, mqttUrl, base, token;

before(async () => {
  if (!DB) return;
  Object.assign(process.env, { DATABASE_URL: DB, HTTP_PORT: '0', MQTT_PORT: '0', RPC_TIMEOUT_MS: '3000',
    ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password' });
  ({ pool } = await import('../src/db.js'));
  await pool.query('DROP TABLE IF EXISTS alarms, events, telemetry, panels, users CASCADE');
  const { start } = await import('../src/index.js');
  app = await start({});
  mqttUrl = `mqtt://localhost:${app.broker.port()}`;
  base = `http://localhost:${app.http.port()}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }) });
  token = (await r.json()).token;
});

after(async () => {
  if (!DB) return;
  await app.stop();
  await pool.end();
});

const api = async (path, opts = {}) => {
  const r = await fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: opts.body && JSON.stringify(opts.body) });
  return { status: r.status, body: await r.json() };
};

const connect = (opts) => new Promise((resolve, reject) => {
  const c = mqtt.connect(mqttUrl, { reconnectPeriod: 0, ...opts });
  c.once('connect', () => resolve(c));
  c.once('error', reject);
});
const nextMessage = (c) => new Promise((resolve) => c.once('message', (t, m) => resolve({ topic: t, body: JSON.parse(m) })));
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function provision(name, key = 'cms-provision-key') {
  const c = await connect({ clientId: name, username: 'provision' });
  await c.subscribeAsync('/provision/response');
  const msg = nextMessage(c);
  c.publish('/provision/request', JSON.stringify({ deviceName: name, provisionDeviceKey: key, provisionDeviceSecret: 'cms-provision-secret' }));
  const { body } = await msg;
  await c.endAsync();
  return body;
}

test('provisioning gives a token, same device gets same token, bad key fails', { skip }, async () => {
  const a = await provision('CMS-111');
  assert.equal(a.status, 'SUCCESS');
  assert.equal((await provision('CMS-111')).credentialsValue, a.credentialsValue);
  assert.equal((await provision('CMS-999', 'wrong')).status, 'FAILURE');
});

test('bad token is refused', { skip }, async () => {
  await assert.rejects(connect({ clientId: 'x', username: 'nope' }));
});

test('telemetry, fault alarms, RPC and panel isolation', { skip }, async () => {
  const t1 = (await provision('CMS-201')).credentialsValue;
  const t2 = (await provision('CMS-202')).credentialsValue;
  const p1 = await connect({ clientId: 'CMS-201', username: t1 });
  const p2 = await connect({ clientId: 'CMS-202', username: t2 });
  await p1.subscribeAsync('v1/devices/me/rpc/request/+', { qos: 1 });
  await p2.subscribeAsync('v1/devices/me/rpc/request/+', { qos: 1 });
  const p2got = [];
  p2.on('message', (t) => p2got.push(t));

  const values = { vR: 230, vY: 231, vB: 229, iR: 14, iY: 14, iB: 14, kwR: 3.2, kwY: 3.2, kwB: 3.2, kwTotal: 9.6,
    kwh: 100, light: true, f_lampR: true, f_door: false };
  p1.publish('v1/devices/me/telemetry', JSON.stringify({ ts: Date.now(), values }));
  p1.publish('v1/devices/me/telemetry', JSON.stringify({ ts: Date.now(), values: { event: 'f_door RAISED' } }));

  const panels = await waitFor(async () => {
    const { body } = await api('/api/panels');
    const p = body.find((x) => x.device_name === 'CMS-201');
    return p?.latest?.kwTotal === 9.6 && p.active_alarms === 2 && body;
  });
  const id = panels.find((x) => x.device_name === 'CMS-201').id;
  const { body: alarms } = await api(`/api/alarms?active=1&panel=${id}`);
  assert.deepEqual(alarms.map((a) => a.code).sort(), ['f_door', 'f_lampR']);

  // Snapshot jisme lamp fault nahi -> alarm clear
  p1.publish('v1/devices/me/telemetry', JSON.stringify({ ts: Date.now() + 1000, values: { ...values, f_lampR: false, f_door: true, kwh: 101 } }));
  await waitFor(async () => (await api(`/api/alarms?active=1&panel=${id}`)).body.length === 1);

  // Command sirf panel 1 ko jaye
  p1.on('message', (topic, msg) => {
    const reqId = topic.split('/').pop();
    assert.deepEqual(JSON.parse(msg), { method: 'setLight', params: false });
    p1.publish(`v1/devices/me/rpc/response/${reqId}`, JSON.stringify({ ok: true }));
  });
  const r = await api(`/api/panels/${id}/rpc`, { method: 'POST', body: { method: 'setLight', params: false } });
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.deepEqual(p2got, []);

  // Panel 1 dusre panel ka topic subscribe kare to bhi kuch na mile; galat topic pe publish = disconnect
  const bad = await connect({ clientId: 'CMS-202b', username: t2 });
  const closed = new Promise((res) => bad.once('close', res));
  bad.publish('v1/devices/other/telemetry', '{}');
  await closed;

  const { body: hist } = await api(`/api/panels/${id}/telemetry`);
  assert.ok(hist.length >= 1);
  const { body: events } = await api(`/api/events?panel=${id}`);
  assert.ok(events.some((e) => e.type === 'command' && e.username === 'admin'));

  await p1.endAsync();
  await p2.endAsync();
});

test('viewer cannot send commands; offline sweep raises alarm', { skip }, async () => {
  const created = await api('/api/users', { method: 'POST', body: { username: 'viewer1', password: 'viewerpass', role: 'viewer' } });
  assert.equal(created.status, 201);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'viewer1', password: 'viewerpass' }) });
  const vt = (await login.json()).token;
  const r = await fetch(`${base}/api/panels/1/rpc`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${vt}` }, body: JSON.stringify({ method: 'setLight', params: true }) });
  assert.equal(r.status, 403);

  const { sweepOffline } = await import('../src/service.js');
  const n = await sweepOffline(new Date(Date.now() + 60 * 60e3));
  assert.ok(n >= 1);
  const { body } = await api('/api/alarms?active=1');
  assert.ok(body.some((a) => a.code === 'offline'));
});
