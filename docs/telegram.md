# Run the complete Telegram → PostgreSQL → Codex → Telegram flow

Requirements: Node.js 24+, a dedicated PostgreSQL database, authenticated Codex CLI and a newly rotated Telegram bot token. The Codex smoke test was reported passing by the user in a normal Windows PowerShell. The restricted desktop command environment still cannot initialize the live CLI.

1. Rotate the bot token through BotFather and save it in a secret manager or a local secret file outside this repository. Do not paste it into chat, source control or command arguments.
2. Run `npm ci`. Prepare PostgreSQL. The included `docker compose up -d postgres` uses POSTGRES_PASSWORD from your environment and only exposes the database on localhost. An existing dedicated development database also works.
3. Copy `.env.example` to `.env`, set DATABASE_URL (or DATABASE_URL_FILE), TELEGRAM_BOT_TOKEN_FILE and your numeric TELEGRAM_ALLOWED_USERS. The username defaults to guilherme_local_codex_agent_bot and is checked against getMe. Empty TELEGRAM_ALLOWED_CHATS accepts only each authorized user's own private chat; group chats require explicit numeric chat IDs.
4. Run `npm run smoke:codex` in a normal terminal, then `npm start`. This loads .env if it exists and starts long polling, the worker and delivery. Send a text message to the bot from an authorized account. `npm run status` prints counts without exposing message contents or secrets. Ctrl+C shuts down the loops.

Do not run this process for a bot already owned by another polling process. A database advisory lock prevents a second hub gateway from starting against the same database and bot. An existing Telegram webhook is detected and is never deleted automatically. Telegram-side polling conflicts are reported as safe retry messages.

For separate processes, use `npm run gateway` and `npm run worker`. The gateway needs the Telegram token and database; the worker needs DATABASE_URL, WORKER_ROOT and CODEX_AUTH_HOME. It does not need a Telegram token. Codex child processes receive a filtered environment, so neither the Telegram token nor DATABASE_URL is inherited. Use dedicated runtime containers with resource and network limits when deploying; a separate folder and read-only Codex sandbox alone do not provide full container isolation.

## Webhook mode

Set TELEGRAM_MODE=webhook, TELEGRAM_WEBHOOK_SECRET_FILE and an appropriate HOST/PORT behind an HTTPS reverse proxy. Register your public `/telegram/webhook` endpoint with Telegram's setWebhook method and the same secret_token. Registration is a separate operator action; this application never changes webhook configuration automatically. The gateway checks the X-Telegram-Bot-Api-Secret-Token header using a constant-time comparison, enforces a 128 KiB body limit, accepts only valid update IDs and returns 503 when persistence fails so Telegram can retry. `/healthz` checks database availability. In polling mode, no HTTP listener is opened.

## Reliability and limitations

Incoming updates and polling offsets commit together. Replayed updates cannot create duplicate jobs. Jobs route deterministically to Codex, serialize within bot/chat/user/topic/agent sessions, retain the last six successful turns with a bounded prompt, retry with leases and fencing, and record a generic user-facing failure reply after explicit final failure.

Worker completion and outgoing chunks commit in one transaction. Replies split into chunks below Telegram's text limit without breaking Unicode surrogate pairs. Delivery is ordered per session, retries explicit 429 rate limits, and records permanent 4xx failures. Telegram sendMessage has no application-supplied idempotency key: a network error, 5xx response or expired sending lease can leave delivery uncertain. Such rows are marked `uncertain` and block subsequent replies for that session until an operator checks the chat and resolves the row. The hub does not blindly resend and risk duplicate replies. Before manually requeueing, verify whether the message reached Telegram. Do not claim exactly-once external delivery.

`npm run status` lists uncertain row IDs. After inspecting the corresponding chat, use `npm run outbox:resolve -- UUID --mark-sent` for an already delivered reply, `--retry` only when you have confirmed it was not delivered, or `--discard` to abandon it. These commands change only uncertain rows and never display message bodies or tokens.

Database backups, data retention, resource limits and deployment secrets must be configured in the deployment environment. No production deployment or live Telegram exchange was performed during implementation. The integration tests use a simulated Telegram transport and actual PostgreSQL connections; live Codex was verified separately by the user.

Protocol reference: https://core.telegram.org/bots/api#getupdates and https://core.telegram.org/bots/api#sendmessage.
