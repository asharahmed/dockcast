-- Public status page history (docs/api.md GET /status). The API process writes one row per
-- component per minute (ts truncated to the minute, so concurrent instances collide on the
-- primary key and the extra insert is dropped). Uptime and the 14-day strip are computed from
-- these rows. Nothing here is user data and nothing beyond a boolean is stored per sample.
CREATE TABLE status_samples (
  ts         timestamptz NOT NULL,
  component  text        NOT NULL,   -- 'website' | 'stations' | 'forecasts' | 'database'
  ok         boolean     NOT NULL,
  PRIMARY KEY (component, ts)
);

SELECT create_hypertable('status_samples', 'ts', chunk_time_interval => INTERVAL '7 days');
SELECT add_retention_policy('status_samples', INTERVAL '90 days');
