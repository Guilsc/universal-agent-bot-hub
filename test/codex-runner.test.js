import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexRunner } from '../src/codex-runner.js';
test('Codex process uses stdin, separate directories and filtered credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-runner-'));const dirs=[];
 const original=process.env.TELEGRAM_BOT_TOKEN;process.env.TELEGRAM_BOT_TOKEN='test-secret';
 const spawnProcess=(exe,args,options)=>{
  assert.equal(options.shell,false);assert.equal(options.env.TELEGRAM_BOT_TOKEN,undefined);
  assert.ok(args.includes('read-only'));assert.ok(args.includes('--ephemeral'));
  dirs.push(args[args.indexOf('-C')+1]);
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  let input='';child.stdin.on('data',c=>input+=c);
  child.stdin.on('finish',async()=>{assert.equal(input,'hello');await writeFile(args[args.indexOf('-o')+1],'ok');child.emit('close',0);});return child;
 };
 try {
  const run=createCodexRunner({root,spawnProcess});
  assert.deepEqual(await run({session:'a',payload:{text:'hello'}}),{text:'ok'});
  await run({session:'b',payload:{text:'hello'}});assert.notEqual(dirs[0],dirs[1]);
 } finally {if(original===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=original;await rm(root,{recursive:true,force:true});}
});
