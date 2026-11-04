# Development and verification

## Requirements

- Node.js 24+ and npm for the demo and test suite.
- PostgreSQL 17 for server-backed operation and independent-connection integration tests.
- Authenticated Codex CLI for live worker execution only; unit tests use simulated or local Node child processes.

```sh
npm ci
npm test
npm run demo
```

`npm test` covers the SQLite prototype, PostgreSQL SQL through PGlite, authorization, webhooks, queue/outbox behavior, history, and Codex process handling. Two server-backed tests skip when `TEST_DATABASE_URL` is unset. PGlite does not establish multi-connection concurrency correctness.

For server-backed checks, set `TEST_DATABASE_URL` through your environment to a dedicated disposable PostgreSQL database, then run `npm test`. These tests create and drop unique schemas. Never point them at a production database. The [GitHub Actions workflow](../.github/workflows/test.yml) configures a PostgreSQL 17 service; its presence is not a claim of a passing remote run.

## Local runtime

The included Compose file provides only PostgreSQL, bound to localhost. Set `POSTGRES_PASSWORD` securely before `docker compose up -d postgres`. It does not start the gateway or worker. Configure `.env` from `.env.example`; follow [Telegram setup](telegram.md) for the combined application or split processes.

The worker uses `DATABASE_URL` (or `DATABASE_URL_FILE`), `WORKER_ROOT`, and optional `CODEX_AUTH_HOME` / `CODEX_BIN`. It applies the idempotent database schema before claiming jobs. The gateway additionally requires the Telegram token, explicit bot username, and authorized numeric user IDs.

## Worker contracts

Claims use database time, session ordering, leases, and fencing. Expired workers cannot finish a successor's work. Successful completion records history and outgoing replies transactionally. Telegram delivery is not exactly-once; uncertain sends need manual resolution.

Codex launches without a shell, with a filtered environment that excludes database and Telegram credentials. Defaults are read-only sandboxing and disabled web search; supported overrides and history limits are documented in [Telegram setup](telegram.md). Persistent workspace directories are scoped by session. Per-run prompts, logs, and response files are cleaned up after child exit, including failures. Dedicated runtime containers still need resource/network limits and process-tree termination.

Run `npm run smoke:codex` only in an authorized, authenticated environment. It makes a real model request and may incur usage. A passing child-process test is not evidence of a live Codex response. On Windows, the executable resolver checks PATH and then the desktop installation; `CODEX_BIN` explicitly overrides discovery. Do not disable sandboxing to work around environment restrictions.

The SQLite demo has no automatic migration to PostgreSQL. Production deployment, live Telegram exchanges, and remote CI results require separate operator verification.
