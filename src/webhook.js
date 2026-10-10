import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ingestUpdate } from './gateway.js';
export function createWebhookServer({queue,bot,routes,secret}) {
 const expected=Buffer.from(secret);
 return createServer({requestTimeout:15000,headersTimeout:10000},async(req,res)=>{
  const reply=(code,text)=>{res.writeHead(code,{'content-type':'text/plain'});res.end(text);};
  if(req.method==='GET'&&req.url==='/healthz'){
   try{await queue.pool.query('SELECT 1');reply(200,'ok');}catch{reply(503,'unavailable');}return;
  }
  if(req.method!=='POST'||req.url!=='/telegram/webhook')return reply(404,'not found');
  const received=Buffer.from(String(req.headers['x-telegram-bot-api-secret-token']||''));
  if(received.length!==expected.length||!timingSafeEqual(received,expected))return reply(401,'unauthorized');
  let bytes=0;const chunks=[];
  try{
   for await(const chunk of req){bytes+=chunk.length;if(bytes>128*1024){reply(413,'too large');req.resume();return;}chunks.push(chunk);}
   let update;try{update=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,'invalid JSON');}
   if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)return reply(400,'invalid update');
   await ingestUpdate(queue,bot,update,routes);reply(200,'ok');
  }catch{reply(503,'retry later');}
 });
}
