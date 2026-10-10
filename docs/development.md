# PostgreSQL and Codex worker

Requires Node.js 24+, PostgreSQL 17 and an authenticated Codex CLI. Install dependencies with `npm ci`.

For a local database, set POSTGRES_PASSWORD securely and run `docker compose up -d postgres`. Docker is not installed in the original development environment, so this command has not been run there.

Set DATABASE_URL to the dedicated development database, WORKER_ROOT to an empty dedicated worker directory, and CODEX_AUTH_HOME to a dedicated authenticated Codex home. Start with `npm run worker`. The worker applies the idempotent schema before claiming jobs. Database credentials belong in runtime secrets, not source control. No Telegram credentials are passed to Codex.

The PostgreSQL adapter supports enqueue, claim, renew, finish and fail. Claim/recovery transactions share an advisory lock and enforce one active job per session through a unique partial index. Jobs in a session retain FIFO order across retry backoff. Claims use database time; expired workers cannot finish or renew a successor's job. Execution does not hold the claim lock.

The worker launches `codex exec` without a shell, passes the prompt through stdin, uses read-only sandboxing and ephemeral sessions, filters environment variables, bounds elapsed time and output, and cancels on lease loss or shutdown. Each job has a separate working directory derived from its session. Process sandboxing is not container isolation; deployment must add process-tree termination and CPU/memory/network limits. Conversation history is not implemented yet. No live Codex response has been verified in this environment.

`npm test` runs PostgreSQL SQL against PGlite, a local embedded PostgreSQL engine, and tests the process adapter using a simulated child. Set TEST_DATABASE_URL to a dedicated test database to also test simultaneous claims through independent PostgreSQL connections. This test creates and drops a unique test schema. docs/test-workflow.yml is a GitHub Actions template using its own PostgreSQL service; it is not activated because the current GitHub credential lacks workflow scope. Embedded tests do not establish server concurrency correctness by themselves.

The SQLite prototype remains available for its demo. This phase adds the PostgreSQL adapter; it does not migrate existing SQLite data. Telegram ingress/delivery, outbound outbox and production deployment remain pending.

Codex execution reference: https://developers.openai.com/codex/noninteractive
