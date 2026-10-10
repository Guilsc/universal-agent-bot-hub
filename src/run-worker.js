import { PostgresQueue } from './postgres.js';
import { createCodexRunner } from './codex-runner.js';
import { workOnce } from './worker.js';
import { setTimeout as delay } from 'node:timers/promises';
if(!process.env.DATABASE_URL || !process.env.WORKER_ROOT || !process.env.CODEX_AUTH_HOME) throw new Error('DATABASE_URL, WORKER_ROOT and CODEX_AUTH_HOME required');
const queue=PostgresQueue.connect(process.env.DATABASE_URL);
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
const run=createCodexRunner({root:process.env.WORKER_ROOT,authHome:process.env.CODEX_AUTH_HOME,executable:process.env.CODEX_BIN||'codex'});
try {
 await queue.migrate();
 while(!controller.signal.aborted) {
  if(!await workOnce(queue,run,{signal:controller.signal})) {
   try {await delay(500,undefined,{signal:controller.signal});}catch{break;}
  }
 }
} finally {await queue.close();}
