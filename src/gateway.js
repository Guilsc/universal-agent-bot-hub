import { setTimeout as delay } from 'node:timers/promises';
import { routeTelegram } from './telegram.js';

export async function ingestUpdate(queue,bot,update,routes) {
 const job=routeTelegram(bot,update,routes);
 await queue.recordUpdate(bot,update.update_id,job);
 return Boolean(job);
}
export async function pollOnce(queue,telegram,bot,routes,signal) {
 const updates=await telegram.getUpdates(await queue.offset(bot),signal);
 if(!Array.isArray(updates))throw new Error('Invalid Telegram updates');
 for(const update of updates)await ingestUpdate(queue,bot,update,routes);
 return updates.length;
}
export async function deliveryOnce(queue,telegram,bot,signal) {
 const item=await queue.claimOutgoing(bot);if(!item)return false;
 let outcome;
 try {
  const message=await telegram.send(item.destination,item.text,signal);
  if(!Number.isSafeInteger(message?.message_id))throw new Error('Invalid Telegram acknowledgement');
  outcome={state:'sent',messageId:message.message_id};
 }catch(error){
  if(error.code===429&&!error.ambiguous&&item.attempts<5)outcome={state:'queued',retryAfter:error.retryAfter};
  else if(Number.isInteger(error.code)&&error.code>=400&&error.code<500)outcome={state:'dead'};
  else outcome={state:'uncertain'};
 }
 await queue.outgoingResult(item,outcome);return true;
}
export async function serviceLoop(task,{signal,onError=()=>{},idleMs=500}={}) {
 while(!signal.aborted) {
  try {if(await task())continue;}catch{if(signal.aborted)break;onError();}
  try {await delay(idleMs,undefined,{signal});}catch{break;}
 }
}
