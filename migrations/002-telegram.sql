CREATE TABLE IF NOT EXISTS hub_offsets (
 bot TEXT PRIMARY KEY, next_update BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_outbox (
 id UUID PRIMARY KEY, job_id UUID NOT NULL REFERENCES hub_jobs(id),
 session TEXT NOT NULL, bot TEXT NOT NULL, part INTEGER NOT NULL,
 destination JSONB NOT NULL, text TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','dead','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0, available TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ, lease_token UUID, message_id BIGINT,
 sequence BIGSERIAL UNIQUE NOT NULL, UNIQUE(job_id,part)
);
CREATE INDEX IF NOT EXISTS hub_outbox_claim ON hub_outbox(bot,state,available,sequence);
