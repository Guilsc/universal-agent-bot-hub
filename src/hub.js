import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class Hub {
  constructor(path = ':memory:', { clock = Date.now, maxAttempts = 3 } = {}) {
    this.clock = clock;
    this.maxAttempts = maxAttempts;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, event_key TEXT UNIQUE NOT NULL,
        session TEXT NOT NULL, runtime TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
        available INTEGER NOT NULL, lease_until INTEGER, lease_token TEXT,
        result TEXT
      );`);
  }
  ingestTelegram(bot, update, routes) {
    if (!bot || !Number.isSafeInteger(update?.update_id)) throw new Error('Invalid event identity');
    const message = update.message;
    if (!message?.chat?.id || !message?.from?.id || typeof message.text !== 'string') throw new Error('Unsupported Telegram message');
    const matches = routes.filter(r => r.bot === bot && r.chat === String(message.chat.id) && r.user === String(message.from.id));
    if (matches.length !== 1) throw new Error('No unique authorized route');
    const [route] = matches;
    if (!route.agent || !route.runtime) throw new Error('Invalid route');
    const session = JSON.stringify(['telegram', bot, String(message.chat.id), String(message.from.id), String(message.message_thread_id ?? 0), route.agent]);
    const id = randomUUID();
    const key = JSON.stringify([bot, update.update_id]);
    this.db.prepare('INSERT OR IGNORE INTO jobs(id,event_key,session,runtime,payload,available) VALUES(?,?,?,?,?,?)')
      .run(id, key, session, route.runtime, JSON.stringify({ text: message.text, agent: route.agent }), this.clock());
    return this.db.prepare('SELECT id,session FROM jobs WHERE event_key=?').get(key);
  }
  claim(runtime, leaseMs = 30000) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('Invalid lease');
    const now = this.clock();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE jobs SET state=CASE WHEN attempts>=? THEN 'dead' ELSE 'queued' END,lease_token=NULL,lease_until=NULL WHERE state='running' AND lease_until<=?").run(this.maxAttempts, now);
      const job = this.db.prepare(`SELECT * FROM jobs j WHERE runtime=? AND state='queued' AND available<=?
        AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.session=j.session AND active.state='running')
        ORDER BY available,rowid LIMIT 1`).get(runtime, now);
      if (job) {
        job.lease_token = randomUUID();
        this.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=?").run(now + leaseMs, job.lease_token, job.id);
        job.payload = JSON.parse(job.payload);
      }
      this.db.exec('COMMIT');
      return job;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  finish(job, result) {
    const changed = this.db.prepare("UPDATE jobs SET state='done',result=?,lease_until=NULL,lease_token=NULL WHERE id=? AND state='running' AND lease_token=? AND lease_until>?")
      .run(JSON.stringify(result), job.id, job.lease_token, this.clock()).changes;
    if (!changed) throw new Error('Expired or stale lease');
  }
  fail(job) {
    const changed = this.db.prepare("UPDATE jobs SET state=CASE WHEN attempts>=? THEN 'dead' ELSE 'queued' END,available=?,lease_until=NULL,lease_token=NULL WHERE id=? AND state='running' AND lease_token=? AND lease_until>?")
      .run(this.maxAttempts, this.clock() + 1000, job.id, job.lease_token, this.clock()).changes;
    if (!changed) throw new Error('Expired or stale lease');
  }
  close() { this.db.close(); }
}
