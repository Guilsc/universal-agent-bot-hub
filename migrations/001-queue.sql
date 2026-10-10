CREATE TABLE IF NOT EXISTS hub_jobs (
 id UUID PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, session TEXT NOT NULL,
 runtime TEXT NOT NULL, payload JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','dead')),
 attempts INTEGER NOT NULL DEFAULT 0, available TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ, lease_token UUID, result JSONB,
 sequence BIGSERIAL UNIQUE NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hub_one_running_session ON hub_jobs(session) WHERE state='running';
CREATE INDEX IF NOT EXISTS hub_claim ON hub_jobs(runtime,state,available,sequence);
