import { Hub } from './hub.js';
const hub = new Hub();
const routes = [{bot:'demo',chat:'1',user:'2',agent:'demo-agent',runtime:'mock'}];
const event = hub.ingestTelegram('demo', {update_id:1,message:{chat:{id:1},from:{id:2},text:'Olá!'}}, routes);
const job = hub.claim('mock');
hub.finish(job, {text:`Mock recebeu: ${job.payload.text}`});
console.log(JSON.stringify({event,state:'done',runtime:'mock'}, null, 2));
hub.close();
