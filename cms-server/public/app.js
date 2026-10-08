'use strict';
// Street Light CMS dashboard (plain JS, koi build step nahi)

const S = { token: null, user: null, alarms: {}, current: null, charts: [], map: null };
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => (v == null || Number.isNaN(+v) ? '–' : (+v).toFixed(d));
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - new Date(t)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const can = (role) => ({ viewer: 1, operator: 2, admin: 3 })[S.user?.role] >= ({ viewer: 1, operator: 2, admin: 3 })[role];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${S.token}`, ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) { logout(); throw new Error('Login required'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------------- login ----------------
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#loginError').textContent = '';
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('cms_token', data.token);
    boot();
  } catch (err) { $('#loginError').textContent = err.message; }
});

function logout() {
  localStorage.removeItem('cms_token');
  S.stream?.close();
  location.hash = '#/';
  showLogin();
}
$('#logout').addEventListener('click', logout);

async function boot() {
  S.token = localStorage.getItem('cms_token');
  if (!S.token) return showLogin();
  let meta;
  try { meta = await api('/api/meta'); } catch { return; }
  S.user = meta.user;
  S.alarms = meta.alarms;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#whoami').textContent = `${S.user.username} (${S.user.role})`;
  document.querySelectorAll('[data-role]').forEach((el) => el.classList.toggle('hidden', !can(el.dataset.role)));
  startStream();
  route();
}

// Live updates: koi bhi panel/alarm badle to current page refresh (1 s debounce)
let refreshTimer;
function startStream() {
  S.stream?.close();
  S.stream = new EventSource(`/api/stream?token=${encodeURIComponent(S.token)}`);
  const kick = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { S.current?.refresh?.(); updateAlarmBadge(); }, 1000);
  };
  S.stream.addEventListener('panel', kick);
  S.stream.addEventListener('alarm', kick);
}

async function updateAlarmBadge() {
  const a = await api('/api/alarms?active=1&limit=1000').catch(() => []);
  const n = a.filter((x) => !x.acked_at).length;
  $('#alarmBadge').textContent = n;
  $('#alarmBadge').classList.toggle('hidden', !n);
}

// ---------------- router ----------------
window.addEventListener('hashchange', route);
function route() {
  if (!S.user) return;
  S.charts.forEach((c) => c.destroy());
  S.charts = [];
  S.map?.remove();
  S.map = null;
  const h = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('.topbar nav a').forEach((a) =>
    a.classList.toggle('active', a.getAttribute('href') === `#${h}` || (h.startsWith('/panel') && a.getAttribute('href') === '#/')));
  const m = h.match(/^\/panel\/(\d+)/);
  const view = m ? panelView(+m[1])
    : h === '/alarms' ? alarmsView()
    : h === '/events' ? eventsView()
    : h === '/users' ? usersView()
    : dashboardView();
  S.current = view;
  view.render().catch((err) => { $('#view').innerHTML = `<p class="error">${esc(err.message)}</p>`; });
  updateAlarmBadge();
}

// ---------------- helpers ----------------
const SEV_RANK = { 1: 'critical', 2: 'major', 3: 'minor' };
function panelStatus(p) {
  if (!p.online) return { cls: 'off', text: 'Offline', color: '#8a949e' };
  if (p.worst === 1) return { cls: 'critical', text: 'Fault', color: '#d93025' };
  if (p.worst) return { cls: 'major', text: 'Warning', color: '#e37400' };
  return { cls: 'ok', text: 'OK', color: '#1e8e3e' };
}
const lightPill = (p) => (p.online && p.latest?.light ? '<span class="pill on">ON</span>' : '<span class="pill off">OFF</span>');

function chart(canvas, config) {
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--muted').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--line').trim();
  const c = new Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false }, ...config.options } });
  S.charts.push(c);
  return c;
}

function energyChart(canvas, rows) {
  return chart(canvas, {
    type: 'bar',
    data: { labels: rows.map((r) => r.day.slice(5)), datasets: [{ label: 'kWh', data: rows.map((r) => +r.kwh.toFixed(1)), backgroundColor: '#0f4c81' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh / day' } } } },
  });
}

// ---------------- dashboard ----------------
function dashboardView() {
  let markers = {};
  let panels = [];
  let filter = '';

  function drawTable() {
    const rows = panels.filter((p) => !filter || `${p.name} ${p.zone} ${p.device_name}`.toLowerCase().includes(filter));
    $('#panelRows').innerHTML = rows.map((p) => {
      const st = panelStatus(p);
      return `<tr class="click" data-id="${p.id}">
        <td><span class="dot" style="background:${st.color}"></span>${esc(p.name)}</td>
        <td>${esc(p.zone || '')}</td>
        <td><span class="pill ${st.cls}">${st.text}</span></td>
        <td>${lightPill(p)}</td>
        <td class="num">${p.online ? fmt(p.latest?.kwTotal, 2) : '–'}</td>
        <td class="num">${fmt(p.latest?.kwh, 0)}</td>
        <td class="num">${p.active_alarms || ''}</td>
        <td>${ago(p.last_seen)}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">Abhi koi panel nahi. Panel online aate hi yahan dikhega.</td></tr>';
  }

  async function refresh() {
    const [sum, list] = await Promise.all([api('/api/summary'), api('/api/panels')]);
    panels = list;
    const al = sum.alarms;
    $('#kpis').innerHTML = [
      [`${sum.online} / ${sum.total}`, 'Panels online'],
      [sum.lights_on, 'Panels lights ON'],
      [`${fmt(sum.kw_now, 1)} kW`, 'Load now'],
      [`${fmt(sum.kwh_today, 0)} kWh`, 'Energy today'],
      [`<span style="color:var(--bad)">${al.critical || 0}</span> / <span style="color:var(--warn)">${al.major || 0}</span> / ${al.minor || 0}`, 'Alarms crit / major / minor'],
      [sum.total - sum.online, 'Panels offline'],
    ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
    drawTable();

    const bounds = [];
    for (const p of panels) {
      if (p.lat == null || p.lon == null) continue;
      const st = panelStatus(p);
      bounds.push([p.lat, p.lon]);
      const html = `<b>${esc(p.name)}</b><br>${st.text} · Light ${p.latest?.light && p.online ? 'ON' : 'OFF'}<br>${fmt(p.latest?.kwTotal, 2)} kW<br><a href="#/panel/${p.id}">Open</a>`;
      if (markers[p.id]) {
        markers[p.id].setLatLng([p.lat, p.lon]).setStyle({ fillColor: st.color }).setPopupContent(html);
      } else {
        markers[p.id] = L.circleMarker([p.lat, p.lon], { radius: 8, weight: 1, color: '#fff', fillColor: st.color, fillOpacity: 0.95 })
          .addTo(S.map).bindPopup(html);
      }
    }
    if (bounds.length && !S.mapFitted) { S.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 }); S.mapFitted = true; }
  }

  async function render() {
    $('#view').innerHTML = `
      <div id="kpis" class="kpis"></div>
      <div class="grid cols-2">
        <div class="card"><h3>Map</h3><div id="map"></div></div>
        <div class="card"><h3>Energy, all panels (last 30 days)</h3><div class="chart"><canvas id="energy"></canvas></div></div>
      </div>
      <div class="card">
        <div class="toolbar"><h3 class="grow" style="margin:0">Panels</h3><input id="search" placeholder="Search name / zone"></div>
        <div class="scroll"><table>
          <thead><tr><th>Panel</th><th>Zone</th><th>Status</th><th>Light</th><th class="num">kW</th><th class="num">kWh</th><th class="num">Alarms</th><th>Last data</th></tr></thead>
          <tbody id="panelRows"></tbody></table></div>
      </div>`;
    S.map = L.map('map').setView([22.5, 79], 5);
    S.mapFitted = false;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(S.map);
    $('#search').addEventListener('input', (e) => { filter = e.target.value.toLowerCase(); drawTable(); });
    $('#panelRows').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) location.hash = `#/panel/${tr.dataset.id}`;
    });
    await refresh();
    energyChart($('#energy'), await api('/api/energy?days=30'));
  }
  return { render, refresh };
}

// ---------------- panel detail ----------------
function panelView(id) {
  let hours = 24;
  let histChart;

  async function loadHistory() {
    const from = new Date(Date.now() - hours * 3600e3).toISOString();
    const rows = await api(`/api/panels/${id}/telemetry?from=${from}`);
    const labels = rows.map((r) => new Date(r.ts).toLocaleString('en-IN', hours > 24 ? { day: '2-digit', month: 'short', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' }));
    const ds = (label, key, color, axis) => ({ label, data: rows.map((r) => r[key] == null ? null : +(+r[key]).toFixed(2)), borderColor: color, backgroundColor: color, yAxisID: axis, pointRadius: 0, borderWidth: 1.5 });
    histChart?.destroy();
    histChart = chart($('#hist'), {
      type: 'line',
      data: { labels, datasets: [ds('kW total', 'kw_total', '#7b1fa2', 'kw'), ds('V R', 'v_r', '#d93025', 'v'), ds('V Y', 'v_y', '#c9a400', 'v'), ds('V B', 'v_b', '#1a73e8', 'v')] },
      options: { scales: { kw: { position: 'left', beginAtZero: true, title: { display: true, text: 'kW' } }, v: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Volt' } } } },
    });
  }

  async function refresh() {
    const [p, alarms, events] = await Promise.all([
      api(`/api/panels/${id}`), api(`/api/alarms?panel=${id}&limit=50`), api(`/api/events?panel=${id}&limit=50`)]);
    const v = p.latest || {};
    const st = panelStatus({ ...p, worst: alarms.some((a) => !a.cleared_at && a.severity === 'critical') ? 1 : alarms.some((a) => !a.cleared_at) ? 2 : null });
    $('#pHead').innerHTML = `<h2>${esc(p.name)} <span class="pill ${st.cls}">${st.text}</span> ${lightPill(p)}</h2>
      <div class="muted">${esc(p.device_name)} · ${esc(p.zone || 'no zone')} · last data ${ago(p.last_seen)} · ${p.connected ? 'connected' : 'not connected'}</div>`;
    const row = (lbl, k, d) => `<div class="h">${lbl}</div>${['R', 'Y', 'B'].map((ph) => `<div>${fmt(v[k + ph], d)}</div>`).join('')}`;
    $('#live').innerHTML = `
      <div class="phases"><div></div><div class="h">R</div><div class="h">Y</div><div class="h">B</div>
        ${row('Volt', 'v', 1)}${row('Amp', 'i', 2)}${row('kW', 'kw', 2)}${row('PF', 'pf', 2)}${row('Lamps failed', 'lampsFailed', 0)}</div>
      <div class="facts">
        <div><span>Total kW</span><b>${fmt(v.kwTotal, 2)}</b></div>
        <div><span>Energy kWh</span><b>${fmt(v.kwh, 1)}</b></div>
        <div><span>Frequency</span><b>${fmt(v.freq, 1)} Hz</b></div>
        <div><span>Mode</span><b>${esc(v.mode || '–')}</b></div>
        <div><span>Selector</span><b>${esc(v.selector || '–')}</b></div>
        <div><span>Signal (0-31)</span><b>${v.rssi ?? '–'}</b></div>
        <div><span>Sunset / Sunrise</span><b>${v.sunset != null ? `${hm(v.sunset)} / ${hm(v.sunrise)}` : '–'}</b></div>
        <div><span>MCB tripped</span><b>${esc(v.mcbTripped || 'None')}</b></div>
      </div>`;
    $('#pAlarms').innerHTML = alarmTable(alarms, false);
    $('#pEvents').innerHTML = eventTable(events, false);
    if (can('admin') && !$('#editForm').dataset.filled) {
      const f = $('#editForm');
      for (const k of ['name', 'zone', 'lat', 'lon', 'poles', 'lamp_w']) f.elements[k].value = p[k] ?? '';
      f.dataset.filled = '1';
    }
  }

  async function command(method, params, btn) {
    btn && (btn.disabled = true);
    try {
      const r = await api(`/api/panels/${id}/rpc`, { method: 'POST', body: { method, params } });
      toast(r.ok === false ? `Panel: ${r.error}` : `${method}: done`);
      refresh();
    } catch (err) { toast(err.message); }
    btn && (btn.disabled = false);
  }

  async function render() {
    $('#view').innerHTML = `
      <p><a href="#/">&larr; All panels</a></p>
      <div id="pHead" class="card"></div>
      <div class="grid cols-2">
        <div class="card"><h3>Live values</h3><div id="live"></div></div>
        <div class="card ${can('operator') ? '' : 'hidden'}"><h3>Control</h3>
          <div class="controls">
            <button data-cmd="on">Light ON</button><button data-cmd="off" class="danger">Light OFF</button>
            <button data-cmd="astro" class="secondary">Auto: Astro</button><button data-cmd="sched" class="secondary">Auto: Schedule</button>
            <button data-cmd="status" class="secondary">Refresh status</button>
          </div>
          <div class="controls">
            <label>ON time <input id="onT" type="time" value="18:30"></label>
            <label>OFF time <input id="offT" type="time" value="06:00"></label>
            <button data-cmd="setSched" class="secondary">Save schedule</button>
          </div>
          <div class="controls">
            <label>Sunset + min <input id="onOff" type="number" value="0" style="width:90px"></label>
            <label>Sunrise + min <input id="offOff" type="number" value="0" style="width:90px"></label>
            <button data-cmd="setAstro" class="secondary">Save astro offsets</button>
          </div>
          <p class="muted">Light ON/OFF panel ko MANUAL mode me daalta hai. Wapas auto ke liye Astro ya Schedule dabao.</p>
        </div>
      </div>
      <div class="card">
        <div class="toolbar"><h3 class="grow" style="margin:0">History</h3>
          <span class="tabs"><button data-h="24" class="active">24 h</button><button data-h="168">7 days</button><button data-h="720">30 days</button></span>
          <button id="csv" class="secondary">Download CSV</button></div>
        <div class="chart"><canvas id="hist"></canvas></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><h3>Energy per day (30 days)</h3><div class="chart"><canvas id="pEnergy"></canvas></div></div>
        <div class="card ${can('admin') ? '' : 'hidden'}"><h3>Panel details</h3>
          <form id="editForm" class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px">
            <label>Name <input name="name"></label><label>Zone / Ward <input name="zone"></label>
            <label>Latitude <input name="lat" type="number" step="any"></label><label>Longitude <input name="lon" type="number" step="any"></label>
            <label>Poles <input name="poles" type="number"></label><label>Lamp watt <input name="lamp_w" type="number" step="any"></label>
            <div><button type="submit">Save</button></div>
          </form></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><h3>Alarms</h3><div id="pAlarms" class="scroll"></div></div>
        <div class="card"><h3>Event log</h3><div id="pEvents" class="scroll"></div></div>
      </div>`;

    $('.controls').parentElement.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cmd]');
      if (!b) return;
      const c = b.dataset.cmd;
      if (c === 'on') command('setLight', true, b);
      else if (c === 'off') command('setLight', false, b);
      else if (c === 'astro') command('setMode', 'ASTRO', b);
      else if (c === 'sched') command('setMode', 'SCHEDULE', b);
      else if (c === 'status') command('getStatus', undefined, b);
      else if (c === 'setSched') command('setSchedule', { on: $('#onT').value, off: $('#offT').value, days: 127 }, b);
      else if (c === 'setAstro') command('setAstro', { onOffset: +$('#onOff').value, offOffset: +$('#offOff').value }, b);
    });
    $('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-h]');
      if (!b) return;
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      hours = +b.dataset.h;
      loadHistory();
    });
    $('#csv').addEventListener('click', async () => {
      const from = new Date(Date.now() - hours * 3600e3).toISOString();
      const blob = await api(`/api/panels/${id}/export.csv?from=${from}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `panel-${id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try { await api(`/api/panels/${id}`, { method: 'PATCH', body }); toast('Saved'); refresh(); } catch (err) { toast(err.message); }
    });
    $('#pAlarms').addEventListener('click', ackHandler);

    await refresh();
    await loadHistory();
    energyChart($('#pEnergy'), await api(`/api/panels/${id}/energy?days=30`));
  }
  return { render, refresh };
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------------- alarms / events ----------------
function alarmTable(rows, withPanel = true) {
  if (!rows.length) return '<p class="muted">Koi alarm nahi.</p>';
  return `<table><thead><tr>${withPanel ? '<th>Panel</th>' : ''}<th>Alarm</th><th>Severity</th><th>Raised</th><th>Cleared</th><th>Ack</th></tr></thead><tbody>
    ${rows.map((a) => `<tr>
      ${withPanel ? `<td><a href="#/panel/${a.panel_id}">${esc(a.panel_name)}</a></td>` : ''}
      <td>${esc(S.alarms[a.code]?.label || a.code)}</td>
      <td><span class="pill ${a.severity}">${a.severity}</span></td>
      <td>${when(a.raised_at)}</td>
      <td>${a.cleared_at ? when(a.cleared_at) : '<b>Active</b>'}</td>
      <td>${a.acked_at ? esc(a.acked_by) : can('operator') ? `<button class="secondary" data-ack="${a.id}">Ack</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}

function eventTable(rows, withPanel = true) {
  if (!rows.length) return '<p class="muted">Koi event nahi.</p>';
  return `<table><thead><tr><th>Time</th>${withPanel ? '<th>Panel</th>' : ''}<th>Type</th><th>Event</th><th>User</th></tr></thead><tbody>
    ${rows.map((e) => `<tr><td>${when(e.ts)}</td>
      ${withPanel ? `<td>${e.panel_id ? `<a href="#/panel/${e.panel_id}">${esc(e.panel_name)}</a>` : ''}</td>` : ''}
      <td>${esc(e.type)}</td><td>${esc(e.message)}</td><td>${esc(e.username || '')}</td></tr>`).join('')}
    </tbody></table>`;
}

async function ackHandler(e) {
  const b = e.target.closest('button[data-ack]');
  if (!b) return;
  b.disabled = true;
  try { await api(`/api/alarms/${b.dataset.ack}/ack`, { method: 'POST' }); S.current?.refresh(); updateAlarmBadge(); } catch (err) { toast(err.message); }
}

function alarmsView() {
  let onlyActive = true;
  async function refresh() {
    const rows = await api(`/api/alarms?${onlyActive ? 'active=1&' : ''}limit=500`);
    $('#alarmList').innerHTML = alarmTable(rows);
  }
  async function render() {
    $('#view').innerHTML = `<div class="card"><div class="toolbar"><h2 class="grow" style="margin:0">Alarms</h2>
      <span class="tabs"><button data-a="1" class="active">Active</button><button data-a="0">All (history)</button></span></div>
      <div id="alarmList" class="scroll"></div></div>`;
    $('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      onlyActive = b.dataset.a === '1';
      refresh();
    });
    $('#alarmList').addEventListener('click', ackHandler);
    await refresh();
  }
  return { render, refresh };
}

function eventsView() {
  async function refresh() { $('#eventList').innerHTML = eventTable(await api('/api/events?limit=500')); }
  async function render() {
    $('#view').innerHTML = '<div class="card"><h2>Event log</h2><div id="eventList" class="scroll"></div></div>';
    await refresh();
  }
  return { render, refresh };
}

// ---------------- users ----------------
function usersView() {
  async function refresh() {
    if (!can('admin')) return;
    const rows = await api('/api/users');
    $('#userList').innerHTML = `<table><thead><tr><th>Username</th><th>Role</th><th>Created</th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${when(u.created_at)}</td></tr>`).join('')}</tbody></table>`;
  }
  async function render() {
    $('#view').innerHTML = `<div class="grid cols-2">
      <div class="card ${can('admin') ? '' : 'hidden'}"><h2>Users</h2><div id="userList" class="scroll"></div>
        <h3 style="margin-top:16px">Add user</h3>
        <form id="addUser"><label>Username <input name="username" required></label>
          <label>Password (8+) <input name="password" type="password" minlength="8" required></label>
          <label>Role <select name="role"><option value="viewer">viewer (sirf dekh sakta hai)</option><option value="operator">operator (control + ack)</option><option value="admin">admin</option></select></label>
          <button type="submit">Add</button></form></div>
      <div class="card"><h2>Change my password</h2>
        <form id="pw"><label>Old password <input name="oldPassword" type="password" required></label>
          <label>New password (8+) <input name="newPassword" type="password" minlength="8" required></label>
          <button type="submit">Change</button></form></div></div>`;
    $('#addUser').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('User added'); refresh(); } catch (err) { toast(err.message); }
    });
    $('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password changed'); } catch (err) { toast(err.message); }
    });
    await refresh();
  }
  return { render, refresh };
}

boot();
