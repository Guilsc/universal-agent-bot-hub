# Block 4 — development foundation

Architecture v0.3 target: a modular control plane, PostgreSQL queue, isolated runtime workers, deterministic routing and isolated sessions. Telegram is the first channel.

This branch is an executable local prototype. SQLite provides transactional queue storage for development; it is not the approved production PostgreSQL implementation. The demo worker is a mock and never calls Codex or Telegram.

Implemented: explicit bot/chat/user allowlist; session keys include bot, chat, user, topic and agent; update deduplication; runtime-specific claims; one active job per session; expiring leases with fencing tokens; bounded retries and dead-letter state. Processing is at least once. External replies will need an outbox and idempotency strategy before production. Runtime workers must renew leases for long-running tasks; renewal is not implemented yet.

Next: PostgreSQL migrations and atomic claims with session locking; transactional outbound outbox; secret provider; authenticated webhook ingress; isolated Codex worker processes with resource limits, cancellation and lease renewal; Telegram delivery; metrics and end-to-end integration tests.

The first real bot is @guilherme_local_codex_agent_bot. Rotate any previously shared token before connecting it. Store credentials in a secret manager or deployment secrets, never in source, job payloads or logs. No live token is needed for the prototype.

Hermes and the personal website are outside this repository's scope. Production deployment and merge require separate approval.
