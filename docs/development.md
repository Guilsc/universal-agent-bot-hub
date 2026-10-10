# PostgreSQL and Codex worker

Requires Node.js 24+, PostgreSQL 17 and an authenticated Codex CLI. Install dependencies with `npm ci`.

For a local database, set POSTGRES_PASSWORD securely and run `docker compose up -d postgres`. Docker is not installed in the original development environment, so this command has not been run there.

Set DATABASE_URL to the dedicated development database, WORKER_ROOT to an empty dedicated worker directory, and CODEX_AUTH_HOME to a dedicated authenticated Codex home. Start with `npm run worker`. The worker applies the idempotent schema before claiming jobs. Database credentials belong in runtime secrets, not source control. No Telegram credentials are passed to Codex.

The PostgreSQL adapter supports enqueue, claim, renew, finish and fail. Claim/recovery transactions share an advisory lock and enforce one active job per session through a unique partial index. Jobs in a session retain FIFO order across retry backoff. Claims use database time; expired workers cannot finish or renew a successor's job. Execution does not hold the claim lock.

The worker launches `codex exec` without a shell, passes the prompt through a private file descriptor on stdin, uses read-only sandboxing and ephemeral sessions, filters environment variables, bounds elapsed time and output, and cancels on lease loss or shutdown. Output is directed to a private temporary file to avoid Windows pipe permission failures. Cleanup waits for child exit, and response size is checked before loading the file. Each job has a separate working directory derived from its session. Process sandboxing is not container isolation; deployment must add process-tree termination and CPU/memory/network limits. Conversation history is not implemented yet.

Run `npm run smoke:codex` in a normal development terminal. On Windows the runner checks PATH for codex.exe and then discovers the desktop app under LOCALAPPDATA/OpenAI/Codex/bin, selecting the newest installed executable. CODEX_BIN can override discovery. This validates a real Codex response without Telegram credentials. In the restricted Codex desktop command environment, the CLI itself currently fails with `failed to initialize in-process app-server client: Access is denied`, even after its runtime files are writable. The worker reports this as `Codex internal startup denied by environment`. The process adapter is validated with an actual Node child process; a live model response remains unverified here. Do not disable sandboxing to work around this.

`npm test` runs PostgreSQL SQL against PGlite, a local embedded PostgreSQL engine, and tests simulated and real child processes. Set TEST_DATABASE_URL to a dedicated test database to also test simultaneous claims through independent PostgreSQL connections. This test creates and drops a unique test schema. The concurrency test passed locally on a native PostgreSQL 17.10 server with eight simultaneous pool connections. GitHub Actions is activated with a dedicated PostgreSQL 17 service. Embedded tests alone do not establish server concurrency correctness.

The SQLite prototype remains available for its demo. Existing SQLite data is not automatically migrated. Telegram ingress, delivery, history and the outbox are now implemented; see telegram.md. Production deployment remains pending.

Codex execution reference: https://developers.openai.com/codex/noninteractive
