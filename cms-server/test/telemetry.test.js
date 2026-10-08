import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTelemetry, parseFaultEvent, activeFaults, isSnapshot, toTelemetryRow } from '../src/telemetry.js';

const NOW = Date.UTC(2026, 9, 8, 12);

test('normalizeTelemetry accepts ThingsBoard shapes', () => {
  const ts = Date.UTC(2026, 9, 8, 11);
  assert.deepEqual(normalizeTelemetry({ ts, values: { a: 1 } }, NOW), [{ ts, values: { a: 1 } }]);
  assert.deepEqual(normalizeTelemetry([{ ts, values: { a: 1 } }, { ts, values: { b: 2 } }], NOW).length, 2);
  assert.deepEqual(normalizeTelemetry({ a: 1 }, NOW), [{ ts: NOW, values: { a: 1 } }]);
});

test('normalizeTelemetry replaces bad RTC time with server time', () => {
  assert.equal(normalizeTelemetry({ ts: 1000, values: {} }, NOW)[0].ts, NOW);              // 1970
  assert.equal(normalizeTelemetry({ ts: NOW + 3 * 86400e3, values: {} }, NOW)[0].ts, NOW); // future
  assert.equal(normalizeTelemetry({ ts: 'x', values: {} }, NOW)[0].ts, NOW);
});

test('parseFaultEvent reads firmware events', () => {
  assert.deepEqual(parseFaultEvent('f_lampR RAISED'), { code: 'f_lampR', raised: true });
  assert.deepEqual(parseFaultEvent('f_door CLEARED'), { code: 'f_door', raised: false });
  assert.equal(parseFaultEvent('f_unknown RAISED'), null);
  assert.equal(parseFaultEvent('hello'), null);
});

test('snapshot detection and row mapping', () => {
  const v = { vR: 230, vY: 231, vB: 40, iR: 10, kwTotal: 5.5, kwh: 1234.5, light: true, rssi: 20,
    f_phaseB: true, f_door: false, mode: 'ASTRO' };
  assert.equal(isSnapshot(v), true);
  assert.equal(isSnapshot({ event: 'f_door RAISED' }), false);
  assert.deepEqual(activeFaults(v), ['f_phaseB']);
  const row = toTelemetryRow(v);
  assert.equal(row.v_b, 40);
  assert.equal(row.i_y, null);
  assert.equal(row.light, true);
  assert.deepEqual(row.faults, ['f_phaseB']);
});
