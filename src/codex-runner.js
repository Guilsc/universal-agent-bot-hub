import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,readFile,mkdtemp,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';

export function createCodexRunner({root,executable='codex',spawnProcess=spawn,timeoutMs=120000,maxBytes=1024*1024,authHome}={}) {
 if (!root) throw new Error('Worker root required');
 return async (job,{signal}={}) => {
  if(typeof job?.payload?.text!=='string'||Buffer.byteLength(job.payload.text)>65536) throw new Error('Invalid Codex input');
  const sessionDir=resolve(root,createHash('sha256').update(job.session).digest('hex'));
  await mkdir(sessionDir,{recursive:true});
  const runDir=await mkdtemp(join(sessionDir,'run-'));
  const output=join(runDir,'response.txt');
  const args=['exec','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','--color','never','-C',runDir,'-o',output,'-'];
  // Never pass database, Telegram or unrelated service secrets to the agent.
  const env={};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE']) if(process.env[key]) env[key]=process.env[key];
  if(authHome) env.CODEX_HOME=authHome;
  try {
   await new Promise((accept,reject)=>{
    let child,bytes=0,settled=false,timer;
    const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):accept();};
    const stop=(message)=>{child?.kill('SIGKILL');done(new Error(message));};
    const abort=()=>stop('Worker cancelled');
    if(signal?.aborted) return done(new Error('Worker cancelled'));
    try {child=spawnProcess(executable,args,{env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});} catch {return done(new Error('Codex process unavailable'));}
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>stop('Codex timeout'),timeoutMs);
    for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes) stop('Codex output limit');});
    child.on('error',()=>done(new Error('Codex process unavailable')));
    child.on('close',code=>done(code===0?undefined:new Error('Codex execution failed')));
    child.stdin.on('error',()=>done(new Error('Codex input failed')));
    child.stdin.end(job.payload.text);
   });
   const text=await readFile(output,'utf8');
   if(Buffer.byteLength(text)>maxBytes) throw new Error('Codex response limit');
   return {text};
  } finally {await rm(runDir,{recursive:true,force:true});}
 };
}
