import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
  assert.equal(readFileSync(options.stdio[0],'utf8'),'hello');
  const child=new EventEmitter();child.kill=()=>child.emit('close',1);
  setTimeout(async()=>{await writeFile(args[args.indexOf('-o')+1],'ok');child.emit('close',0);},1);return child;
 };
 try {
  const run=createCodexRunner({root,spawnProcess});
  assert.deepEqual(await run({session:'a',payload:{text:'hello'}}),{text:'ok'});
  await run({session:'b',payload:{text:'hello'}});assert.notEqual(dirs[0],dirs[1]);
 } finally {if(original===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=original;await rm(root,{recursive:true,force:true});}
});
test('real child process works with file descriptors instead of Windows pipes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-native-'));
 const spawnProcess=(exe,args,options)=>spawn(process.execPath,['--input-type=module','-e',
  "import{readFileSync,writeFileSync}from'node:fs';if(readFileSync(0,'utf8')!=='hello')process.exit(1);writeFileSync(process.argv[1],'native-ok');",args[args.indexOf('-o')+1]],options);
 try {assert.deepEqual(await createCodexRunner({root,spawnProcess})({session:'native',payload:{text:'hello'}}),{text:'native-ok'});}
 finally {await rm(root,{recursive:true,force:true});}
});
test('timeout kills child before directory cleanup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-timeout-'));let killed=false;
 const spawnProcess=()=>{const child=new EventEmitter();child.kill=()=>{killed=true;setTimeout(()=>child.emit('close',1),1);return true;};return child;};
 try {
  await assert.rejects(createCodexRunner({root,spawnProcess,timeoutMs:10})({session:'timeout',payload:{text:'hello'}}),/timeout/);
  assert.equal(killed,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('internal permission errors are identified without leaking logs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-denied-'));
 const spawnProcess=(exe,args,options)=>{
  const child=new EventEmitter();child.kill=()=>true;
  writeFileSync(options.stdio[1],'private diagnostic\nError: failed to initialize in-process app-server client: Access is denied. (os error 5)');
  setTimeout(()=>child.emit('close',1),1);return child;
 };
 try {await assert.rejects(createCodexRunner({root,spawnProcess})({session:'denied',payload:{text:'hello'}}),e=>e.message==='Codex internal startup denied by environment');}
 finally{await rm(root,{recursive:true,force:true});}
});

test('workspace files survive turns while per-run prompt and logs are removed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-workspace-'));let workspace,runDir,turn=0;
 const spawnProcess=(exe,args,options)=>{
  assert.ok(args.includes('workspace-write'));assert.ok(args.includes('web_search="live"'));
  assert.ok(args.includes('sandbox_workspace_write.network_access=true'));
  assert.equal(options.env.DATABASE_URL,undefined);
  const next=args[args.indexOf('-C')+1];if(workspace)assert.equal(next,workspace);workspace=next;
  const file=join(workspace,'note.txt');
  if(turn++)assert.equal(readFileSync(file,'utf8'),'saved memory');else writeFileSync(file,'saved memory');
  assert.equal(existsSync(join(workspace,'prompt.txt')),false);
  const output=args[args.indexOf('-o')+1];runDir=join(output,'..');
  const child=new EventEmitter();child.kill=()=>true;
  writeFileSync(output,'done');setTimeout(()=>child.emit('close',0),1);return child;
 };
 try {
  const run=createCodexRunner({root,spawnProcess,sandbox:'workspace-write',webSearch:'live'});
  await run({session:'same',payload:{text:'first'}});assert.equal(existsSync(runDir),false);
  await run({session:'same',payload:{text:'second'}});assert.equal(existsSync(join(workspace,'note.txt')),true);
 }finally{await rm(root,{recursive:true,force:true});}
});
