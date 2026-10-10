import { PostgresQueue } from './postgres.js';
import { TelegramClient } from './telegram.js';
import { loadConfig } from './config.js';
import { createCodexRunner } from './codex-runner.js';
import { workOnce } from './worker.js';
import { pollOnce,deliveryOnce,serviceLoop } from './gateway.js';
import { createWebhookServer } from './webhook.js';

const controller=new AbortController();const {signal}=controller;
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort());
let queue,lock,server,lockHeld=false;
try {
 const config=await loadConfig();
 queue=PostgresQueue.connect(config.databaseUrl);await queue.migrate();
 const telegram=new TelegramClient(config.token);const me=await telegram.getMe(signal);
 if(me.username?.toLowerCase()!==config.username.replace(/^@/,'').toLowerCase())throw new Error('Telegram bot identity mismatch');
 const bot=String(me.id);
 if(config.mode==='polling'&&(await telegram.getWebhookInfo(signal)).url)throw new Error('Existing Telegram webhook must be removed before polling');
 lock=await queue.pool.connect();
 lock.on('error',()=>controller.abort());
 const acquired=await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',['hub-gateway:'+bot]);
 if(!acquired.rows[0].acquired)throw new Error('Another gateway is already running for this bot');
 lockHeld=true;
 const loops=[];
 if(config.mode==='webhook') {
  server=createWebhookServer({queue,bot,routes:config.routes,secret:config.webhookSecret});
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(config.port,config.host,accept);});
 }else loops.push(serviceLoop(()=>pollOnce(queue,telegram,bot,config.routes,signal),{signal,onError:()=>console.error('Telegram polling unavailable; retrying'),idleMs:1500}));
 loops.push(serviceLoop(()=>deliveryOnce(queue,telegram,bot,signal),{signal,onError:()=>console.error('Outbox unavailable; retrying')}));
 if(!process.argv.includes('--gateway-only')) {
  const run=createCodexRunner({root:config.workerRoot,authHome:config.authHome,executable:config.executable});
  loops.push(serviceLoop(()=>workOnce(queue,run,{signal,onFailure:()=>console.error('Codex attempt failed; retry/dead-letter recorded')}),{signal,onError:()=>console.error('Worker queue unavailable; retrying')}));
 }
 console.log(`Hub running: ${config.mode}; bot @${me.username}; authorized users ${config.routes.allowedUsers.length}`);
 await Promise.all(loops);
}catch(error){console.error(error.message?.startsWith('Telegram request failed')?error.message:'Hub startup/runtime failed; check configuration, database and Codex authentication');process.exitCode=1;}
finally {
 controller.abort();
 if(server)await new Promise(accept=>server.close(accept));
 if(lock){if(lockHeld)try{await lock.query('SELECT pg_advisory_unlock_all()');}catch{}lock.release();}
 if(queue)await queue.close();
}
