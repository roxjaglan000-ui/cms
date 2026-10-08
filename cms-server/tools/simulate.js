// Nakli panels: asli firmware jaise hi MQTT messages bhejte hain. Demo aur load test ke liye.
//   node tools/simulate.js --panels 160 --interval 10 --host localhost
// Har panel: provision -> token -> telemetry har --interval second -> commands ka jawab.
import { parseArgs } from 'node:util';
import mqtt from 'mqtt';

const { values: opt } = parseArgs({
  options: {
    host: { type: 'string', default: 'localhost' },
    port: { type: 'string', default: '1883' },
    panels: { type: 'string', default: '5' },
    interval: { type: 'string', default: '10' },        // seconds
    prefix: { type: 'string', default: 'CMS-SIM' },
    key: { type: 'string', default: 'cms-provision-key' },
    secret: { type: 'string', default: 'cms-provision-secret' },
    lat: { type: 'string', default: '28.61' },
    lon: { type: 'string', default: '77.21' },
    faults: { type: 'string', default: '0.01' },        // har tick pe fault aane ka chance
  },
});

const url = `mqtt://${opt.host}:${opt.port}`;
const FAULTS = ['f_lampR', 'f_lampY', 'f_lampB', 'f_door', 'f_mcb', 'f_phaseB'];

function provision(name) {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { clientId: name, username: 'provision', reconnectPeriod: 0 });
    const t = setTimeout(() => { c.end(true); reject(new Error(`${name}: provision timeout`)); }, 15000);
    c.on('connect', () => {
      c.subscribe('/provision/response', () => c.publish('/provision/request', JSON.stringify({
        deviceName: name, provisionDeviceKey: opt.key, provisionDeviceSecret: opt.secret })));
    });
    c.on('message', (topic, msg) => {
      clearTimeout(t);
      c.end(true);
      const r = JSON.parse(msg);
      r.status === 'SUCCESS' ? resolve(r.credentialsValue) : reject(new Error(`${name}: ${r.errorMsg}`));
    });
    c.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function istMinutes(d = new Date()) {
  const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
  return m;
}

async function startPanel(n) {
  const name = `${opt.prefix}-${String(n).padStart(4, '0')}`;
  const token = await provision(name);
  const lampsPerPhase = 80 + Math.floor(Math.random() * 6);
  const lampW = 40;
  const s = {
    mode: 'ASTRO', manual: false, on: 18 * 60 + 15, off: 6 * 60, kwh: 1000 + Math.random() * 5000,
    faults: new Set(), lat: +opt.lat + (Math.random() - 0.5) * 0.25, lon: +opt.lon + (Math.random() - 0.5) * 0.25,
  };
  const lightOn = () => {
    if (s.mode === 'MANUAL') return s.manual;
    const m = istMinutes();
    return s.on > s.off ? (m >= s.on || m < s.off) : (m >= s.on && m < s.off);
  };

  const c = mqtt.connect(url, { clientId: name, username: token, keepalive: 30 });
  let lastTick = Date.now();

  function snapshot() {
    const on = lightOn();
    const now = Date.now();
    const v = [230, 231, 229].map((x) => x + (Math.random() - 0.5) * 6);
    if (s.faults.has('f_phaseB')) v[2] = 40;
    const kw = [0, 1, 2].map((k) => {
      if (!lightOn() || v[k] < 180) return 0;
      const lost = s.faults.has(['f_lampR', 'f_lampY', 'f_lampB'][k]) ? 8 : 0;
      return ((lampsPerPhase - lost) * lampW) / 1000 * (0.98 + Math.random() * 0.04);
    });
    const kwTotal = kw.reduce((a, b) => a + b, 0);
    s.kwh += kwTotal * ((now - lastTick) / 3600e3);
    lastTick = now;
    const values = {
      vR: +v[0].toFixed(1), vY: +v[1].toFixed(1), vB: +v[2].toFixed(1),
      iR: +(kw[0] * 1000 / v[0] / 0.95).toFixed(2), iY: +(kw[1] * 1000 / v[1] / 0.95).toFixed(2),
      iB: +(v[2] < 180 ? 0 : kw[2] * 1000 / v[2] / 0.95).toFixed(2),
      kwR: +kw[0].toFixed(3), kwY: +kw[1].toFixed(3), kwB: +kw[2].toFixed(3),
      pfR: 0.95, pfY: 0.95, pfB: 0.95, kwTotal: +kwTotal.toFixed(3), freq: 50, kwh: +s.kwh.toFixed(2),
      light: on, mode: s.mode, selector: 'AUTO', rssi: 15 + Math.floor(Math.random() * 15),
      lampsFailedR: s.faults.has('f_lampR') ? 8 : 0, lampsFailedY: s.faults.has('f_lampY') ? 8 : 0,
      lampsFailedB: s.faults.has('f_lampB') ? 8 : 0, mcbTripped: s.faults.has('f_mcb') ? 'A-Y' : '',
      lat: +s.lat.toFixed(5), lon: +s.lon.toFixed(5),
    };
    for (const f of ['f_phaseR', 'f_phaseY', 'f_phaseB', 'f_overVolt', 'f_overCurrent', 'f_lampR', 'f_lampY',
      'f_lampB', 'f_contactor', 'f_dayBurn', 'f_mcb', 'f_earthLeak', 'f_door', 'f_meter']) values[f] = s.faults.has(f);
    return { ts: now, values };
  }

  const publish = () => c.publish('v1/devices/me/telemetry', JSON.stringify(snapshot()));
  const event = (code, raised) => c.publish('v1/devices/me/telemetry',
    JSON.stringify({ ts: Date.now(), values: { event: `${code} ${raised ? 'RAISED' : 'CLEARED'}` } }));

  c.on('connect', () => {
    c.subscribe('v1/devices/me/rpc/request/+', { qos: 1 });
    publish();
  });
  c.on('message', (topic, msg) => {
    const id = topic.split('/').pop();
    const { method, params } = JSON.parse(msg);
    const res = { ok: true };
    if (method === 'setLight') { s.mode = 'MANUAL'; s.manual = !!params; }
    else if (method === 'setMode') s.mode = String(params);
    else if (method === 'setSchedule') {
      const hm = (x) => { const [h, m] = String(x).split(':').map(Number); return h * 60 + m; };
      s.on = hm(params?.on ?? '18:30'); s.off = hm(params?.off ?? '06:00');
    } else if (method === 'setLocation') { s.lat = params.lat; s.lon = params.lon; }
    else if (method === 'getStatus') res.status = snapshot().values;
    c.publish(`v1/devices/me/rpc/response/${id}`, JSON.stringify(res));
    publish();
  });

  setInterval(() => {
    if (Math.random() < Number(opt.faults)) {
      const f = FAULTS[Math.floor(Math.random() * FAULTS.length)];
      const raised = !s.faults.has(f);
      raised ? s.faults.add(f) : s.faults.delete(f);
      event(f, raised);
    }
    publish();
  }, Number(opt.interval) * 1000 * (0.9 + Math.random() * 0.2));
  return name;
}

const count = Number(opt.panels);
let ok = 0;
for (let i = 1; i <= count; i++) {
  try { await startPanel(i); ok++; } catch (e) { console.error(e.message); }
}
console.log(`${ok}/${count} simulated panels running against ${url}. Ctrl+C to stop.`);
