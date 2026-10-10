import { setTimeout as delay } from 'node:timers/promises';
export async function workOnce(queue,run,{leaseMs=30000,signal}={}) {
 const job=await queue.claim('codex',leaseMs); if(!job)return false;
 const controller=new AbortController();
 const cancel=()=>controller.abort(); signal?.addEventListener('abort',cancel,{once:true});
 if(signal?.aborted)controller.abort();
 let renewalError;
 const renewLoop=(async()=>{
  while(!controller.signal.aborted) {
   try {await delay(Math.max(1,Math.floor(leaseMs/3)),undefined,{signal:controller.signal});}
   catch {return;}
   try {await queue.renew(job,leaseMs);} catch(e){renewalError=e;controller.abort();return;}
  }
 })();
 try {
  const result=await run(job,{signal:controller.signal});
  controller.abort(); await renewLoop;
  if(renewalError || signal?.aborted)throw new Error('Worker lease lost or cancelled');
  await queue.finish(job,result);
 } catch {
  controller.abort();await renewLoop;
  // A stale worker must never modify its successor's work.
  try {await queue.fail(job);} catch {}
 } finally {controller.abort();await renewLoop;signal?.removeEventListener('abort',cancel);}
 return true;
}
