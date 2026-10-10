import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm,utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodexExecutable } from '../src/codex-executable.js';
test('explicit executable overrides discovery and Linux keeps PATH lookup',async()=>{
 assert.equal(await resolveCodexExecutable({executable:'custom',env:{CODEX_BIN:'env'}}),'custom');
 assert.equal(await resolveCodexExecutable({env:{CODEX_BIN:'env'},platform:'win32'}),'env');
 assert.equal(await resolveCodexExecutable({env:{},platform:'linux'}),'codex');
});
test('Windows finds desktop Codex without PATH and prefers PATH when present',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-discovery-'));
 try {
  const bin=join(root,'OpenAI','Codex','bin');
  for(const version of ['old','new','incomplete'])await mkdir(join(bin,version),{recursive:true});
  const older=join(bin,'old','codex.exe'),newer=join(bin,'new','codex.exe');
  await writeFile(older,'');await writeFile(newer,'');await utimes(older,1,1);await utimes(newer,2,2);
  const env={LOCALAPPDATA:root};
  assert.equal(await resolveCodexExecutable({env,platform:'win32'}),newer);
  const pathBin=join(root,'path directory');await mkdir(pathBin);const pathExe=join(pathBin,'codex.exe');await writeFile(pathExe,'');
  assert.equal(await resolveCodexExecutable({env:{...env,Path:`"${pathBin}"`},platform:'win32'}),pathExe);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Windows reports a missing installation clearly',async()=>{
 await assert.rejects(resolveCodexExecutable({env:{},platform:'win32'}),/executable not found/);
});
