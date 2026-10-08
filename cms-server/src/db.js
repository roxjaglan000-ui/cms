import { readFile } from 'node:fs/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const q = (text, params) => pool.query(text, params);

export async function migrate(log = console) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await q(sql);
  await enableTimescale(log);
  const { rows } = await q('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const hash = await bcrypt.hash(config.adminPassword, 10);
    await q('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
      [config.adminUser, hash, 'admin']);
    log.info?.(`Created admin user "${config.adminUser}". Pehli login ke baad password badlo.`);
  }
}

// TimescaleDB ho to telemetry ko hypertable bana do (compression + 6 saal retention).
// Plain PostgreSQL pe bhi sab chalta hai, bas 5 saal baad disk thoda zyada lagega.
async function enableTimescale(log) {
  try {
    await q('CREATE EXTENSION IF NOT EXISTS timescaledb');
  } catch {
    log.info?.('TimescaleDB not available, using plain PostgreSQL tables');
    return;
  }
  try {
    await q("SELECT create_hypertable('telemetry', 'ts', if_not_exists => true, migrate_data => true)");
    await q("ALTER TABLE telemetry SET (timescaledb.compress, timescaledb.compress_segmentby = 'panel_id')");
    await q("SELECT add_compression_policy('telemetry', INTERVAL '7 days', if_not_exists => true)");
    await q("SELECT add_retention_policy('telemetry', INTERVAL '6 years', if_not_exists => true)");
    log.info?.('TimescaleDB hypertable ready');
  } catch (err) {
    log.warn?.(`TimescaleDB setup skipped: ${err.message}`);
  }
}
