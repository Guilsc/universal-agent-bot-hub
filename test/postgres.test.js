import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PostgresQueue } from '../src/postgres.js';
import { workOnce } from '../src/worker.js';
test('PostgreSQL SQL: migration, deduplication, ordering, fencing and worker completion',async()=>{
 const db=new PGlite();
 const query=(sql,params)=>params?db.query(sql,params):db.exec(sql).then(r=>r.at(-1));
 const pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};
 const q=new PostgresQueue(pool,{maxAttempts:2});
 try {
 await q.migrate();await q.migrate();
 const first=await q.enqueue({eventKey:'1',session:'a',runtime:'codex',payload:{text:'hi'}});
 assert.equal((await q.enqueue({eventKey:'1',session:'a',runtime:'codex',payload:{text:'changed'}})).id,first.id);
 await q.enqueue({eventKey:'2',session:'a',runtime:'codex',payload:{text:'second'}});
 await q.enqueue({eventKey:'3',session:'b',runtime:'other',payload:{text:'other'}});
 const job=await q.claim('codex');assert.equal(job.id,first.id);assert.equal(await q.claim('codex'),undefined);
 await q.renew(job);await q.fail(job);assert.equal(await q.claim('codex'),undefined);
 await db.query("UPDATE hub_jobs SET available=now() WHERE id=$1",[job.id]);
 const retry=await q.claim('codex');assert.notEqual(retry.lease_token,job.lease_token);
 await assert.rejects(q.finish(job,{}),/stale/);
 await db.query("UPDATE hub_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[retry.id]);
 const next=await q.claim('codex');assert.notEqual(next.id,retry.id);
 assert.equal((await db.query('SELECT state FROM hub_jobs WHERE id=$1',[retry.id])).rows[0].state,'dead');
 await q.finish(next,{text:'done'});
 await q.enqueue({eventKey:'4',session:'a',runtime:'codex',payload:{text:'worker'}});
 assert.equal(await workOnce(q,async()=>({text:'worker response'})),true);
 assert.equal((await db.query("SELECT result FROM hub_jobs WHERE event_key='4'")).rows[0].result.text,'worker response');
 assert.equal(await workOnce(q,async()=>({})),false);
 } finally {await q.close();}
});
test('worker cancels when renewal fails and never completes stale work',async()=>{
 let finished=false,failed=false;
 const q={claim:async()=>({id:'1'}),renew:async()=>{throw new Error('stale');},finish:async()=>{finished=true;},fail:async()=>{failed=true;throw new Error('stale');}};
 await workOnce(q,async(job,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})),{leaseMs:15});
 assert.equal(finished,false);assert.equal(failed,true);
});
