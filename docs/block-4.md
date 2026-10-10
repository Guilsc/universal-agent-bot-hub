# Block 4 — development foundation

Architecture v0.3 target: a modular control plane, PostgreSQL queue, isolated runtime workers, deterministic routing and isolated sessions. Telegram is the first channel.

This branch is an executable local prototype. SQLite provides transactional queue storage for development; it is not the approved production PostgreSQL implementation. The demo worker is a mock and never calls Codex or Telegram.

Implemented: explicit bot/chat/user allowlist; session keys include bot, chat, user, topic and agent; update deduplication; runtime-specific claims; one active job per session; expiring leases with fencing tokens; bounded retries and dead-letter state. Processing is at least once. External replies will need an outbox and idempotency strategy before production. Runtime workers must renew leases for long-running tasks; renewal is not implemented yet.

Update: PostgreSQL schema/adapter and Codex process worker with cancellation and lease renewal are implemented. See development.md for current validation and limitations.

Update: Telegram polling and authenticated webhook ingress, file/environment secrets, transactional outbox, bounded conversation history, delivery recovery and status commands are implemented. See telegram.md for complete setup.

Remaining deployment work: rotated live token and authorized user IDs, container resource limits, backups/retention and a live Telegram end-to-end exchange. No production deployment has been performed.

The first real bot is @guilherme_local_codex_agent_bot. Rotate any previously shared token before connecting it. Store credentials in a secret manager or deployment secrets, never in source, job payloads or logs. No live token is needed for the prototype.

Hermes and the personal website are outside this repository's scope. Production deployment and merge require separate approval.
