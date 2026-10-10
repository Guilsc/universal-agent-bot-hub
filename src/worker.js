import { setTimeout as delay } from 'node:timers/promises';
import { commandReply } from './bot-commands.js';
export async function workOnce(queue,run,{leaseMs=30000,signal,onFailure=()=>{},onProgress,capabilities}={}) {
 const job=await queue.claim('codex',leaseMs); if(!job)return false;
 const controller=new AbortController();
 const cancel=()=>controller.abort(); signal?.addEventListener('abort',cancel,{once:true});
 if(signal?.aborted)controller.abort();
 let renewalError;
 const progressLoop=onProgress&&!job.payload.command?(async()=>{
  while(!controller.signal.aborted){
   try {await onProgress(job,controller.signal);}catch{}
   try {await delay(4000,undefined,{signal:controller.signal});}catch{return;}
  }
 })():Promise.resolve();
 const renewLoop=(async()=>{
  while(!controller.signal.aborted) {
   try {await delay(Math.max(1,Math.floor(leaseMs/3)),undefined,{signal:controller.signal});}
   catch {return;}
   try {await queue.renew(job,leaseMs);} catch(e){renewalError=e;controller.abort();return;}
  }
 })();
 try {
  let executionJob=job;
  if(queue.context&&!job.payload.command){
   const history=await queue.context(job);
   if(history.length){
    let text;
    do {text=`Conversation history (JSON):\n${JSON.stringify(history)}\n\nLatest user message:\n${job.payload.text}`;if(Buffer.byteLength(text)>65536)history.shift();else break;}while(history.length);
    if(history.length)executionJob={...job,payload:{...job.payload,text}};
   }
  }
  const result=job.payload.command?{text:commandReply(job.payload.command,capabilities)}:await run(executionJob,{signal:controller.signal});
  controller.abort(); await renewLoop;
  if(renewalError || signal?.aborted)throw new Error('Worker lease lost or cancelled');
  await queue.finish(job,result);
 } catch {
  controller.abort();await renewLoop;
  // A stale worker must never modify its successor's work.
  try {await queue.fail(job);} catch {}
  onFailure(job.id);
 } finally {controller.abort();await Promise.all([renewLoop,progressLoop]);signal?.removeEventListener('abort',cancel);}
 return true;
}
