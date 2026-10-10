import { PostgresQueue } from './postgres.js';
import { createCodexRunner } from './codex-runner.js';
import { workOnce } from './worker.js';
import { setTimeout as delay } from 'node:timers/promises';
import { readSecret,loadRunnerConfig } from './config.js';
if(!process.env.WORKER_ROOT || !process.env.CODEX_AUTH_HOME) throw new Error('WORKER_ROOT and CODEX_AUTH_HOME required');
const runnerConfig=loadRunnerConfig();
const queue=PostgresQueue.connect(await readSecret(process.env,'DATABASE_URL'),{historyTurns:runnerConfig.historyTurns});
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
const run=createCodexRunner({root:process.env.WORKER_ROOT,authHome:process.env.CODEX_AUTH_HOME,executable:process.env.CODEX_BIN,...runnerConfig});
try {
 await queue.migrate();
 while(!controller.signal.aborted) {
  if(!await workOnce(queue,run,{signal:controller.signal,capabilities:runnerConfig,onFailure:()=>console.error('Codex attempt failed; retry/dead-letter recorded')})) {
   try {await delay(500,undefined,{signal:controller.signal});}catch{break;}
  }
 }
} finally {await queue.close();}
