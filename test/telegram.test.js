import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresQueue } from '../src/postgres.js';
import { TelegramClient,TelegramError,routeTelegram,splitReply } from '../src/telegram.js';
import { pollOnce,deliveryOnce } from '../src/gateway.js';
import { workOnce } from '../src/worker.js';
import { createWebhookServer } from '../src/webhook.js';
import { loadConfig } from '../src/config.js';

const routes={allowedUsers:['42'],allowedChats:[]};
const update=(id,text='hello',user=42)=>({update_id:id,message:{message_id:id+100,from:{id:user},chat:{id:user,type:'private'},text}});

async function database(server=false) {
 if(server){
  const schema='hub_flow_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  return {queue:new PostgresQueue(pool),query:(...args)=>pool.query(...args),close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }
 const db=new PGlite();const query=(sql,params)=>params?db.query(sql,params):db.exec(sql).then(results=>results.at(-1));
 return {queue:new PostgresQueue({query,connect:async()=>({query,release(){}})}),query,close:()=>db.close()};
}

async function completeFlow(server) {
 const db=await database(server);const q=db.queue;
 try{
  await q.migrate();const sent=[];
  const telegram={getUpdates:async()=>[update(1),update(2,'blocked',99)],send:async(destination,text)=>{sent.push({destination,text});return{message_id:123};}};
  await pollOnce(q,telegram,'bot',routes);await pollOnce(q,telegram,'bot',routes);
  assert.equal(await q.offset('bot'),3);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM hub_jobs')).rows[0].count,1);
  await workOnce(q,async job=>{assert.equal(job.payload.text,'hello');return{text:'answer 😀'};});
  assert.equal((await db.query('SELECT state FROM hub_outbox')).rows[0].state,'queued');
  assert.equal(await deliveryOnce(q,telegram,'bot'),true);assert.equal(await deliveryOnce(q,telegram,'bot'),false);
  assert.equal(sent.length,1);assert.equal(sent[0].text,'answer 😀');assert.equal(sent[0].destination.chatId,'42');
  telegram.getUpdates=async()=>[update(3,'next')];await pollOnce(q,telegram,'bot',routes);
  await workOnce(q,async job=>{assert.match(job.payload.text,/answer 😀/);assert.match(job.payload.text,/Latest user message:\nnext/);return{text:'second'};});
  await deliveryOnce(q,telegram,'bot');assert.equal(sent.length,2);
 }finally{await db.close();}
}
test('Telegram complete flow: durable ingress → worker history → transactional reply',()=>completeFlow(false));
test('Telegram complete flow through real PostgreSQL connections',{skip:!process.env.TEST_DATABASE_URL},()=>completeFlow(true));

test('authorization, topic isolation and Unicode chunking',()=>{
 assert.equal(routeTelegram('bot',update(1,'test',99),routes),undefined);
 const group=update(1);group.message.chat={id:-5,type:'group'};assert.equal(routeTelegram('bot',group,routes),undefined);
 assert.ok(routeTelegram('bot',group,{...routes,allowedChats:['-5']}));
 const topic=update(1);topic.message.message_thread_id=7;assert.notEqual(routeTelegram('bot',topic,routes).session,routeTelegram('bot',update(1),routes).session);
 const parts=splitReply('😀'.repeat(3000));assert.ok(parts.every(part=>part.length<=4000));assert.equal(parts.join(''),'😀'.repeat(3000));
 assert.throws(()=>splitReply(''),/Empty/);
});

test('Telegram transport redacts tokens and preserves explicit rate-limit metadata',async()=>{
 const token='123:test_secret';
 const broken=new TelegramClient(token,{fetchImpl:async()=>{throw new Error('url contains '+token);}});
 await assert.rejects(broken.getMe(),error=>error.ambiguous&&!error.message.includes(token)&&!error.cause);
 const limited=new TelegramClient(token,{fetchImpl:async()=>({ok:false,status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:5}})})});
 await assert.rejects(limited.send({chatId:'42'},'hi'),error=>error.code===429&&error.retryAfter===5&&!error.ambiguous);
});

test('outbox rate limits retry; ambiguous sends stop; stale leases cannot acknowledge',async()=>{
 const db=await database();const q=db.queue;
 try {
  await q.migrate();await q.recordUpdate('bot',1,routeTelegram('bot',update(1),routes));
  const job=await q.claim('codex');await q.finish(job,{text:'first'});
  const limited={send:async()=>{throw new TelegramError(429,{retryAfter:3});}};
  await deliveryOnce(q,limited,'bot');assert.equal((await db.query('SELECT state FROM hub_outbox')).rows[0].state,'queued');
  await db.query('UPDATE hub_outbox SET available=now()');
  await deliveryOnce(q,{send:async()=>{throw new TelegramError('network',{ambiguous:true});}},'bot');
  assert.equal((await db.query('SELECT state FROM hub_outbox')).rows[0].state,'uncertain');
  await q.recordUpdate('bot',2,routeTelegram('bot',update(2),routes));await q.finish(await q.claim('codex'),{text:'second'});
  assert.equal(await q.claimOutgoing('bot'),undefined);
  await db.query("UPDATE hub_outbox SET state='sent' WHERE state='uncertain'");
  const outgoing=await q.claimOutgoing('bot');await db.query("UPDATE hub_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[outgoing.id]);
  assert.equal(await q.claimOutgoing('bot'),undefined);
  await assert.rejects(q.outgoingResult(outgoing,{state:'sent',messageId:1}),/stale/);
 }finally{await db.close();}
});

test('worker failure generates a generic reply after final attempt',async()=>{
 const db=await database();const q=db.queue;q.maxAttempts=1;
 try{
  await q.migrate();await q.recordUpdate('bot',1,routeTelegram('bot',update(1),routes));
  await workOnce(q,async()=>{throw new Error('private runtime diagnostic');});
  const {rows}=await db.query('SELECT text FROM hub_outbox');assert.equal(rows.length,1);assert.ok(!rows[0].text.includes('private'));
 }finally{await db.close();}
});
test('expired final worker lease creates one failure reply and failed ingest rolls back its offset',async()=>{
 const db=await database();const q=db.queue;q.maxAttempts=1;
 try{
  await q.migrate();await q.recordUpdate('bot',1,routeTelegram('bot',update(1),routes));
  const job=await q.claim('codex');await db.query("UPDATE hub_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
  assert.equal(await q.claim('codex'),undefined);assert.equal(await q.claim('codex'),undefined);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM hub_outbox')).rows[0].count,1);
  await assert.rejects(q.finish(job,{text:'late reply'}),/stale/);
  const before=await q.offset('bot');const invalid=routeTelegram('bot',update(2),routes);invalid.runtime=null;
  await assert.rejects(q.recordUpdate('bot',2,invalid));assert.equal(await q.offset('bot'),before);
 }finally{await db.close();}
});

test('webhook authenticates, rejects malformed requests and waits for persistence',async()=>{
 const recorded=[];const queue={pool:{query:async()=>{}},recordUpdate:async(...args)=>recorded.push(args)};
 const secret='s'.repeat(32);const server=createWebhookServer({queue,bot:'bot',routes,secret});
 await new Promise(accept=>server.listen(0,'127.0.0.1',accept));const url=`http://127.0.0.1:${server.address().port}`;
 const headers={'x-telegram-bot-api-secret-token':secret};
 try{
  assert.equal((await fetch(url+'/healthz')).status,200);
  assert.equal((await fetch(url+'/telegram/webhook',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(url+'/telegram/webhook',{method:'POST',headers,body:'not JSON'})).status,400);
  assert.equal((await fetch(url+'/telegram/webhook',{method:'POST',headers,body:JSON.stringify(update(1,'Olá 😀'))})).status,200);
  assert.equal(recorded[0][2].payload.text,'Olá 😀');
  queue.recordUpdate=async()=>{throw new Error('database unavailable');};
  assert.equal((await fetch(url+'/telegram/webhook',{method:'POST',headers,body:JSON.stringify(update(2))})).status,503);
 }finally{await new Promise(accept=>server.close(accept));}
});

test('configuration fails closed without authorized users',async()=>{
 await assert.rejects(loadConfig({}),/TELEGRAM_ALLOWED_USERS/);
 await assert.rejects(loadConfig({TELEGRAM_ALLOWED_USERS:'42',TELEGRAM_MODE:'webhook'}),/WEBHOOK_SECRET/);
});
