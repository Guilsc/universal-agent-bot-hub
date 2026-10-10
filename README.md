# universal-agent-bot-hub
Independent multichannel agent platform — architecture v0.3, Telegram first.

## Run locally

Requires Node.js 24 or newer. The mock demo needs no tokens.

```sh
npm ci
npm test
npm run demo
```

The complete Telegram flow supports polling or authenticated webhooks,
PostgreSQL persistence, a Codex CLI worker, isolated conversation history and
transactional outgoing replies. See [Telegram setup](docs/telegram.md).

```sh
# Configure .env and runtime secrets first
npm start
```

The original SQLite mock demo remains available. See
[development setup](docs/development.md) for tests and environment limitations.
Production deployment has not been performed.
