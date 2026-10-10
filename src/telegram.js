import { commandFor } from './bot-commands.js';
export class TelegramError extends Error {
 constructor(code,{retryAfter=1,ambiguous=false}={}) {
  super(`Telegram request failed (${code})`);this.code=code;this.retryAfter=retryAfter;this.ambiguous=ambiguous;
 }
}

export class TelegramClient {
 constructor(token,{fetchImpl=fetch}={}) {
  if(typeof token!=='string'||!/^\d+:[A-Za-z0-9_-]+$/.test(token))throw new Error('Invalid Telegram token configuration');
  this.token=token;this.fetch=fetchImpl;
 }
 async call(method,body={},signal) {
  const timeout=AbortSignal.timeout(method==='getUpdates'?45000:15000);
  try {
   const response=await this.fetch(`https://api.telegram.org/bot${this.token}/${method}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
    signal:signal?AbortSignal.any([signal,timeout]):timeout
   });
   const data=await response.json();
   if(!response.ok||!data.ok)throw new TelegramError(data.error_code||response.status,{
    retryAfter:Math.min(3600,Math.max(1,Number(data.parameters?.retry_after)||1)),
    ambiguous:response.status>=500
   });
   return data.result;
  }catch(error){
   if(error instanceof TelegramError)throw error;
   // fetch errors can contain a URL with the token. Do not retain their cause.
   throw new TelegramError('network',{ambiguous:true});
  }
 }
 getMe(signal){return this.call('getMe',{},signal);}
 getWebhookInfo(signal){return this.call('getWebhookInfo',{},signal);}
 setCommands(commands,signal){return this.call('setMyCommands',{commands},signal);}
 typing(destination,signal){return this.call('sendChatAction',{chat_id:destination.chatId,action:'typing',...(destination.topic?{message_thread_id:destination.topic}:{})},signal);}
 getUpdates(offset,signal){return this.call('getUpdates',{offset,timeout:30,allowed_updates:['message']},signal);}
 send(destination,text,signal){return this.call('sendMessage',{
  chat_id:destination.chatId,text,
  ...(destination.topic?{message_thread_id:destination.topic}:{}),
  ...(destination.replyTo?{reply_parameters:{message_id:destination.replyTo,allow_sending_without_reply:true}}:{})
 },signal);}
}

export function routeTelegram(bot,update,{allowedUsers,allowedChats=[],agent='codex-default',username,notifications=false}={}) {
 if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)throw new Error('Invalid update');
 const message=update.message;
 if(!message||typeof message.text!=='string'||!message.text.trim()||Buffer.byteLength(message.text)>65536)return undefined;
 if(!Number.isSafeInteger(message.from?.id)||!Number.isSafeInteger(message.chat?.id)||!Number.isSafeInteger(message.message_id))return undefined;
 const user=String(message.from.id),chat=String(message.chat.id);
 if(!allowedUsers.includes(user))return undefined;
 if(allowedChats.length?!allowedChats.includes(chat):message.chat.type!=='private'||chat!==user)return undefined;
 const command=commandFor(message.text,username);
 if(command==='other-bot')return undefined;
 const topic=message.message_thread_id;
 if(topic!==undefined&&(!Number.isSafeInteger(topic)||topic<=0))return undefined;
 return {
  eventKey:JSON.stringify(['telegram',bot,update.update_id]),
  session:JSON.stringify(['telegram',bot,chat,user,topic??0,agent]),runtime:'codex',
  payload:{text:message.text,agent,...(command?{command}:{}),...(notifications?{notifications:true}:{}),delivery:{bot,chatId:chat,topic,replyTo:message.message_id}}
 };
}

export function splitReply(text,limit=4000) {
 if(typeof text!=='string'||!text.trim())throw new Error('Empty worker reply');
 const parts=[];let part='';
 for(const character of text){if(part.length+character.length>limit){parts.push(part);part='';}part+=character;}
 if(part)parts.push(part);return parts;
}
