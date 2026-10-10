# universal-agent-bot-hub
Independent multichannel agent platform — architecture v0.3, Telegram first.

## Run locally

Requires Node.js 24 or newer. The mock demo needs no tokens.

```sh
npm ci
npm test
npm run demo
```

The original demo uses SQLite and a mock worker. A PostgreSQL queue adapter
and Codex CLI process worker are now implemented; see
[development setup](docs/development.md) for configuration and test limitations.
Telegram networking and production deployment are pending.
