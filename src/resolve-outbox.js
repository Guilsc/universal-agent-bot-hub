import { PostgresQueue } from './postgres.js';
import { readSecret } from './config.js';
const [id,action]=process.argv.slice(2);
if(!/^[0-9a-f-]{36}$/i.test(id||'')||!['--mark-sent','--retry','--discard'].includes(action)) {
 console.error('Usage: npm run outbox:resolve -- UUID --mark-sent|--retry|--discard');process.exit(1);
}
const state={'--mark-sent':'sent','--retry':'queued','--discard':'dead'}[action];
const queue=PostgresQueue.connect(await readSecret(process.env,'DATABASE_URL'));
try{
 const {rows}=await queue.pool.query("UPDATE hub_outbox SET state=$2,available=now(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND state='uncertain' RETURNING id",[id,state]);
 if(!rows.length)throw new Error('No uncertain outbox row matches this ID');
 console.log(`Outbox ${id}: ${state}`);
}finally{await queue.close();}
