import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresQueue } from '../src/postgres.js';
test('PostgreSQL server: simultaneous workers cannot claim the same session',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const schema='hub_test_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 const q=new PostgresQueue(pool);
 try {
  await q.migrate();
  for(let i=0;i<8;i++)await q.enqueue({eventKey:String(i),session:'same',runtime:'codex',payload:{text:'test'}});
  const claims=await Promise.all(Array.from({length:8},()=>q.claim('codex')));
  assert.equal(claims.filter(Boolean).length,1);
  await q.finish(claims.find(Boolean),{text:'done'});
  assert.ok(await q.claim('codex'));
 } finally {await q.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
