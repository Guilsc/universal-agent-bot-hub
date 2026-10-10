import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,readFile,mkdtemp,rm,writeFile,open,stat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { resolveCodexExecutable } from './codex-executable.js';

export function createCodexRunner({root,executable,spawnProcess=spawn,timeoutMs=120000,maxBytes=1024*1024,authHome}={}) {
 if (!root) throw new Error('Worker root required');
 return async (job,{signal}={}) => {
  if(typeof job?.payload?.text!=='string'||Buffer.byteLength(job.payload.text)>65536) throw new Error('Invalid Codex input');
  const codexExecutable=await resolveCodexExecutable({executable});
  const sessionDir=resolve(root,createHash('sha256').update(job.session).digest('hex'));
  await mkdir(sessionDir,{recursive:true});
  const runDir=await mkdtemp(join(sessionDir,'run-'));
  const output=join(runDir,'response.txt');
  const prompt=join(runDir,'prompt.txt');
  const log=join(runDir,'process.log');
  const args=['exec','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','--color','never','-C',runDir,'-o',output,'-'];
  // Never pass database, Telegram or unrelated service secrets to the agent.
  const env={};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE']) if(process.env[key]) env[key]=process.env[key];
  if(authHome) env.CODEX_HOME=authHome;
  let inputHandle,logHandle;
  try {
   await writeFile(prompt,job.payload.text,{mode:0o600});
   inputHandle=await open(prompt,'r');
   logHandle=await open(log,'w',0o600);
   try {await new Promise((accept,reject)=>{
    let child,settled=false,timer,monitor,stopError,checking=false;
    const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(monitor);signal?.removeEventListener('abort',abort);error?reject(error):accept();};
    const stop=(message)=>{if(stopError||settled)return;stopError=new Error(message);child?.kill('SIGKILL');};
    const abort=()=>stop('Worker cancelled');
    if(signal?.aborted) return done(new Error('Worker cancelled'));
    // File descriptors work on Windows installations that deny anonymous pipes.
    try {child=spawnProcess(codexExecutable,args,{env,windowsHide:true,shell:false,stdio:[inputHandle.fd,logHandle.fd,logHandle.fd]});} catch(e) {return done(new Error(`Codex process unavailable (${e.code||'unknown'})`));}
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>stop('Codex timeout'),timeoutMs);
    monitor=setInterval(async()=>{
     if(checking||settled)return;checking=true;
     try {if((await stat(log)).size>maxBytes)stop('Codex output limit');}catch{}finally{checking=false;}
    },50);
    child.on('error',e=>done(new Error(`Codex process unavailable (${e.code||'unknown'})`)));
    child.on('close',code=>done(stopError||(code===0?undefined:new Error('Codex execution failed'))));
   });} catch(error) {
    // Classify only known startup failures; never expose raw child logs.
    const size=(await stat(log)).size;
    if(size<=maxBytes) {
     const diagnostic=await readFile(log,'utf8');
     if(diagnostic.includes('failed to initialize in-process app-server client')&&diagnostic.includes('Access is denied')) {
      throw new Error('Codex internal startup denied by environment');
     }
    }
    throw error;
   }
   if((await stat(log)).size>maxBytes)throw new Error('Codex output limit');
   if((await stat(output)).size>maxBytes)throw new Error('Codex response limit');
   const text=await readFile(output,'utf8');
   if(Buffer.byteLength(text)>maxBytes) throw new Error('Codex response limit');
   return {text};
  } finally {await inputHandle?.close();await logHandle?.close();await rm(runDir,{recursive:true,force:true});}
 };
}
