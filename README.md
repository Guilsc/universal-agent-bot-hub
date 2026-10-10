# universal-agent-bot-hub
Independent multichannel agent platform — architecture v0.3, Telegram first.

## Run locally

Requires Node.js 24 or newer. No dependencies or tokens are required.

```sh
npm test
npm run demo
```

This is a development foundation with SQLite queue storage and a mock worker.
Telegram networking, a real Codex worker and PostgreSQL are pending. See
[Block 4 plan](docs/block-4.md) for implemented behavior and production gaps.
