import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from '../src/hub.js';
const routes = [{bot:'a',chat:'1',user:'2',agent:'codex',runtime:'codex'}, {bot:'b',chat:'1',user:'2',agent:'codex',runtime:'codex'}];
const update = id => ({update_id:id,message:{chat:{id:1},from:{id:2},text:'hello'}});
test('deduplicates events and isolates bots', () => {
 const h=new Hub(); try {
 const a=h.ingestTelegram('a',update(1),routes);
 assert.equal(h.ingestTelegram('a',update(1),routes).id,a.id);
 assert.notEqual(h.ingestTelegram('b',update(1),routes).session,a.session);
 assert.throws(()=>h.ingestTelegram('unknown',update(1),routes),/authorized/);
 assert.throws(()=>h.ingestTelegram('a',update(3),[...routes,routes[0]]),/unique/);
 assert.equal(h.claim('other'),undefined);
 } finally {h.close();}
});
test('retries failed work after backoff and rejects malformed input', () => {
 let now=0; const h=new Hub(':memory:',{clock:()=>now}); try {
 assert.throws(()=>h.ingestTelegram('a',{},routes),/identity/);
 const event=h.ingestTelegram('a',update(1),routes);
 const first=h.claim('codex'); h.fail(first);
 assert.equal(h.claim('codex'),undefined);
 now=1000; const retry=h.claim('codex'); assert.equal(retry.id,event.id);
 h.finish(retry,{text:'ok'}); assert.equal(h.claim('codex'),undefined);
 } finally {h.close();}
});
test('serializes sessions and fences expired workers', () => {
 let now=0; const h=new Hub(':memory:',{clock:()=>now,maxAttempts:2}); try {
 h.ingestTelegram('a',update(1),routes); h.ingestTelegram('a',update(2),routes);
 const first=h.claim('codex',10); assert.equal(h.claim('codex'),undefined);
 now=11; const retry=h.claim('codex',10);
 assert.equal(retry.id,first.id); assert.throws(()=>h.finish(first,{}),/stale/);
 h.fail(retry); assert.equal(h.db.prepare('SELECT state FROM jobs WHERE id=?').get(first.id).state,'dead');
 assert.ok(h.claim('codex'));
 } finally {h.close();}
});
test('persists work and coordinates independent connections', () => {
 const dir=mkdtempSync(join(tmpdir(),'hub-')); const path=join(dir,'queue.db');
 let a=new Hub(path); a.ingestTelegram('a',update(1),routes); a.close();
 a=new Hub(path); const b=new Hub(path); try {
 const job=a.claim('codex'); assert.ok(job); assert.equal(b.claim('codex'),undefined);
 a.finish(job,{text:'done'}); assert.equal(b.db.prepare('SELECT state FROM jobs').get().state,'done');
 } finally {a.close();b.close();rmSync(dir,{recursive:true});}
});
