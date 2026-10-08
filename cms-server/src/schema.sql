CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Ek row = ek feeder panel. device_name = firmware ka "CMS-<IMEI>".
CREATE TABLE IF NOT EXISTS panels (
  id          serial PRIMARY KEY,
  device_name text UNIQUE NOT NULL,
  token       text UNIQUE NOT NULL,
  name        text,
  zone        text,
  lat         double precision,
  lon         double precision,
  poles       integer,
  lamp_w      real,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz,
  online      boolean NOT NULL DEFAULT false,
  latest      jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_ts   timestamptz
);

-- Har 5 min ka meter data. 5 saal ~8.4 crore rows (160 panel).
CREATE TABLE IF NOT EXISTS telemetry (
  panel_id  integer NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  ts        timestamptz NOT NULL,
  v_r real, v_y real, v_b real,
  i_r real, i_y real, i_b real,
  kw_r real, kw_y real, kw_b real,
  pf_r real, pf_y real, pf_b real,
  kw_total real,
  kwh      double precision,
  freq     real,
  light    boolean,
  rssi     smallint,
  faults   text[] NOT NULL DEFAULT '{}',
  data     jsonb NOT NULL,
  PRIMARY KEY (panel_id, ts)
);

CREATE TABLE IF NOT EXISTS events (
  id        bigserial PRIMARY KEY,
  panel_id  integer REFERENCES panels(id) ON DELETE CASCADE,
  ts        timestamptz NOT NULL DEFAULT now(),
  type      text NOT NULL,         -- fault, command, system, user
  message   text NOT NULL,
  username  text
);
CREATE INDEX IF NOT EXISTS events_panel_ts ON events (panel_id, ts DESC);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts DESC);

CREATE TABLE IF NOT EXISTS alarms (
  id         bigserial PRIMARY KEY,
  panel_id   integer NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  code       text NOT NULL,        -- f_phaseR ... ya "offline"
  severity   text NOT NULL,        -- critical, major, minor
  raised_at  timestamptz NOT NULL,
  cleared_at timestamptz,
  acked_at   timestamptz,
  acked_by   text
);
-- Ek panel pe ek code ka ek hi active alarm
CREATE UNIQUE INDEX IF NOT EXISTS alarms_one_active ON alarms (panel_id, code) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS alarms_raised ON alarms (raised_at DESC);
