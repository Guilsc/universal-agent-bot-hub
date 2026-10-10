import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

export class PostgresQueue {
 constructor(pool, {maxAttempts=3}={}) {this.pool=pool;this.maxAttempts=maxAttempts;}
 static connect(connectionString) {return new PostgresQueue(new pg.Pool({connectionString}));}
 async migrate() {await this.pool.query(await readFile(new URL('../migrations/001-queue.sql',import.meta.url),'utf8'));}
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
   await client.query(`UPDATE hub_jobs SET state=CASE WHEN attempts >= $1 THEN 'dead' ELSE 'queued' END,
    lease_until=NULL,lease_token=NULL WHERE state='running' AND lease_until<=now()`,[this.maxAttempts]);
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
 async finish(job,result) {await this.update(job,"state='done',result=$3,lease_token=NULL,lease_until=NULL",[JSON.stringify(result)]);}
 async fail(job) {await this.update(job,"state=CASE WHEN attempts >= $3 THEN 'dead' ELSE 'queued' END,available=now()+interval '1 second',lease_token=NULL,lease_until=NULL",[this.maxAttempts]);}
 async close() {await this.pool.end();}
}
