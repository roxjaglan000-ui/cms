// Panel firmware ke messages ko samajhne wale pure functions (database se alag, test karna aasan).

// Firmware ke FAULT_KEYS + server ka "offline"
export const ALARMS = {
  f_phaseR:      { severity: 'critical', label: 'R phase fail / low voltage' },
  f_phaseY:      { severity: 'critical', label: 'Y phase fail / low voltage' },
  f_phaseB:      { severity: 'critical', label: 'B phase fail / low voltage' },
  f_overVolt:    { severity: 'critical', label: 'Over voltage' },
  f_overCurrent: { severity: 'critical', label: 'Over current' },
  f_lampR:       { severity: 'major',    label: 'Lamps failed on R phase' },
  f_lampY:       { severity: 'major',    label: 'Lamps failed on Y phase' },
  f_lampB:       { severity: 'major',    label: 'Lamps failed on B phase' },
  f_contactor:   { severity: 'critical', label: 'Contactor fault (ON command, no output)' },
  f_dayBurn:     { severity: 'major',    label: 'Day burning (lights ON in day)' },
  f_mcb:         { severity: 'major',    label: 'Outgoing MCB tripped' },
  f_earthLeak:   { severity: 'critical', label: 'Earth leakage / RCCB trip' },
  f_door:        { severity: 'minor',    label: 'Panel door open' },
  f_meter:       { severity: 'critical', label: 'Energy meter not responding' },
  offline:       { severity: 'critical', label: 'Panel offline (no data)' },
};

export const FAULT_CODES = Object.keys(ALARMS).filter((c) => c.startsWith('f_'));

const MIN_VALID_TS = Date.UTC(2025, 0, 1);
const MAX_FUTURE_MS = 24 * 3600 * 1000;

// ThingsBoard format: {ts, values} | [{ts, values}, ...] | {key: value}
export function normalizeTelemetry(payload, now = Date.now()) {
  const items = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const hasValues = item.values && typeof item.values === 'object';
    const values = hasValues ? item.values : item;
    let ts = Number(hasValues ? item.ts : NaN);
    // RTC ka time galat ho (battery khatam) to server ka time lo
    if (!Number.isFinite(ts) || ts < MIN_VALID_TS || ts > now + MAX_FUTURE_MS) ts = now;
    out.push({ ts, values });
  }
  return out;
}

// "f_lampR RAISED" -> { code: 'f_lampR', raised: true }
export function parseFaultEvent(text) {
  const m = /^(f_[A-Za-z]+)\s+(RAISED|CLEARED)$/.exec(String(text || '').trim());
  if (!m || !ALARMS[m[1]]) return null;
  return { code: m[1], raised: m[2] === 'RAISED' };
}

export function activeFaults(values) {
  return FAULT_CODES.filter((c) => values[c] === true);
}

// Full snapshot hai ya sirf event message?
export function isSnapshot(values) {
  return 'kwTotal' in values || 'vR' in values;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toTelemetryRow(values) {
  return {
    v_r: num(values.vR), v_y: num(values.vY), v_b: num(values.vB),
    i_r: num(values.iR), i_y: num(values.iY), i_b: num(values.iB),
    kw_r: num(values.kwR), kw_y: num(values.kwY), kw_b: num(values.kwB),
    pf_r: num(values.pfR), pf_y: num(values.pfY), pf_b: num(values.pfB),
    kw_total: num(values.kwTotal),
    kwh: num(values.kwh),
    freq: num(values.freq),
    light: typeof values.light === 'boolean' ? values.light : null,
    rssi: num(values.rssi),
    faults: activeFaults(values),
  };
}
