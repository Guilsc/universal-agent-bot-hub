import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { splitReply } from './telegram.js';

export class PostgresQueue {
 constructor(pool, {maxAttempts=3}={}) {this.pool=pool;this.maxAttempts=maxAttempts;}
 static connect(connectionString) {return new PostgresQueue(new pg.Pool({connectionString}));}
 async migrate() {
  await this.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(724090)');
   for(const name of ['001-queue.sql','002-telegram.sql'])await client.query(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  });
 }
 async transaction(action) {
  const client=await this.pool.connect();
  try {await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async enqueue({eventKey,session,runtime,payload}) {
  if (![eventKey,session,runtime].every(x=>typeof x==='string' && x.length>0)) throw new Error('Invalid job');
  const {rows}=await this.pool.query(`INSERT INTO hub_jobs(id,event_key,session,runtime,payload)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id,session`,
   [randomUUID(),eventKey,session,runtime,JSON.stringify(payload)]);
  return rows[0];
 }
 async claim(runtime,leaseMs=30000) {
  if (!Number.isSafeInteger(leaseMs)||leaseMs<1) throw new Error('Invalid lease');
  const client=await this.pool.connect();
  try {
   await client.query('BEGIN');
   // Serialize claim/recovery only; model execution never holds this lock.
   await client.query('SELECT pg_advisory_xact_lock(724091)');
   const recovered=await client.query(`UPDATE hub_jobs SET state=CASE WHEN attempts >= $1 THEN 'dead' ELSE 'queued' END,
    lease_until=NULL,lease_token=NULL WHERE state='running' AND lease_until<=now() RETURNING *`,[this.maxAttempts]);
   for(const expired of recovered.rows){
    const delivery=expired.payload?.delivery;
    if(expired.state==='dead'&&delivery)await client.query(`INSERT INTO hub_outbox(id,job_id,session,bot,part,destination,text)
     VALUES($1,$2,$3,$4,0,$5,$6) ON CONFLICT(job_id,part) DO NOTHING`,[randomUUID(),expired.id,expired.session,delivery.bot,JSON.stringify(delivery),'Não consegui concluir esta solicitação. Tente novamente mais tarde.']);
   }
   const {rows}=await client.query(`WITH candidate AS (
    SELECT j.id FROM hub_jobs j WHERE runtime=$1 AND state='queued' AND available<=now()
    AND NOT EXISTS(SELECT 1 FROM hub_jobs active WHERE active.session=j.session AND active.state='running')
    AND NOT EXISTS(SELECT 1 FROM hub_jobs earlier WHERE earlier.session=j.session AND earlier.sequence<j.sequence AND earlier.state='queued')
    ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE hub_jobs SET state='running',attempts=attempts+1,lease_token=$2,
    lease_until=now()+$3*interval '1 millisecond' WHERE id IN(SELECT id FROM candidate) RETURNING *`,[runtime,randomUUID(),leaseMs]);
   await client.query('COMMIT'); return rows[0];
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
 }
 async renew(job,leaseMs=30000) {
  if (!Number.isSafeInteger(leaseMs)||leaseMs<1) throw new Error('Invalid lease');
  await this.update(job,"lease_until=now()+$3*interval '1 millisecond'",[leaseMs]);
 }
 async update(job,set,values=[]) {
  const {rows}=await this.pool.query(`UPDATE hub_jobs SET ${set} WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id`,[job.id,job.lease_token,...values]);
  if (!rows.length) throw new Error('Expired or stale lease');
 }
 async finish(job,result) {
  const delivery=job.payload?.delivery;
  const parts=delivery?splitReply(result.text):[];
  await this.transaction(async client=>{
   const {rows}=await client.query("UPDATE hub_jobs SET state='done',result=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id",[job.id,job.lease_token,JSON.stringify(result)]);
   if(!rows.length)throw new Error('Expired or stale lease');
   for(const [part,text] of parts.entries())await client.query(`INSERT INTO hub_outbox(id,job_id,session,bot,part,destination,text)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_id,part) DO NOTHING`,[randomUUID(),job.id,job.session,delivery.bot,part,JSON.stringify(delivery),text]);
  });
 }
 async context(job) {
  const {rows}=await this.pool.query("SELECT payload->>'text' AS request,result->>'text' AS response FROM hub_jobs WHERE session=$1 AND state='done' AND sequence<$2 ORDER BY sequence DESC LIMIT 6",[job.session,job.sequence]);
  return rows.reverse().map(row=>({request:row.request.slice(0,4000),response:(row.response||'').slice(0,4000)}));
 }
 async offset(bot) {const {rows}=await this.pool.query('SELECT next_update FROM hub_offsets WHERE bot=$1',[bot]);return Number(rows[0]?.next_update||0);}
 async recordUpdate(bot,updateId,job) {
  await this.transaction(async client=>{
   if(job)await client.query('INSERT INTO hub_jobs(id,event_key,session,runtime,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING',
    [randomUUID(),job.eventKey,job.session,job.runtime,JSON.stringify(job.payload)]);
   await client.query('INSERT INTO hub_offsets(bot,next_update) VALUES($1,$2) ON CONFLICT(bot) DO UPDATE SET next_update=GREATEST(hub_offsets.next_update,EXCLUDED.next_update)',[bot,updateId+1]);
  });
 }
 async claimOutgoing(bot,leaseMs=30000) {
  return this.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(724092)');
   // An expired sending job may already have reached Telegram. Do not resend blindly.
   await client.query("UPDATE hub_outbox SET state='uncertain',lease_token=NULL,lease_until=NULL WHERE state='sending' AND lease_until<=now()");
   const {rows}=await client.query(`WITH candidate AS(
    SELECT o.id FROM hub_outbox o WHERE bot=$1 AND state='queued' AND available<=now()
    AND NOT EXISTS(SELECT 1 FROM hub_outbox earlier WHERE earlier.session=o.session AND earlier.sequence<o.sequence AND earlier.state IN('queued','sending','uncertain'))
    ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE hub_outbox SET state='sending',attempts=attempts+1,lease_token=$2,lease_until=now()+$3*interval '1 millisecond'
    WHERE id IN(SELECT id FROM candidate) RETURNING *`,[bot,randomUUID(),leaseMs]);
   return rows[0];
  });
 }
 async outgoingResult(item,{state,messageId=null,retryAfter=1}) {
  if(!['sent','queued','dead','uncertain'].includes(state))throw new Error('Invalid outbox state');
  const {rows}=await this.pool.query(`UPDATE hub_outbox SET state=$3,message_id=$4,available=now()+$5*interval '1 second',lease_token=NULL,lease_until=NULL
   WHERE id=$1 AND lease_token=$2 AND state='sending' AND lease_until>now() RETURNING id`,[item.id,item.lease_token,state,messageId,retryAfter]);
  if(!rows.length)throw new Error('Expired or stale outbox lease');
 }
 async fail(job) {
  await this.transaction(async client=>{
   const {rows}=await client.query(`UPDATE hub_jobs SET state=CASE WHEN attempts >= $3 THEN 'dead' ELSE 'queued' END,
    available=now()+interval '1 second',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING state`,[job.id,job.lease_token,this.maxAttempts]);
   if(!rows.length)throw new Error('Expired or stale lease');
   const delivery=job.payload?.delivery;
   if(rows[0].state==='dead'&&delivery)await client.query(`INSERT INTO hub_outbox(id,job_id,session,bot,part,destination,text)
    VALUES($1,$2,$3,$4,0,$5,$6) ON CONFLICT(job_id,part) DO NOTHING`,[randomUUID(),job.id,job.session,delivery.bot,JSON.stringify(delivery),'Não consegui concluir esta solicitação. Tente novamente mais tarde.']);
  });
 }
 async close() {await this.pool.end();}
}
