import { PostgresQueue } from './postgres.js';
import { readSecret } from './config.js';
const queue=PostgresQueue.connect(await readSecret(process.env,'DATABASE_URL'));
try{
 const jobs=await queue.pool.query('SELECT state,count(*)::int AS count FROM hub_jobs GROUP BY state');
 const outgoing=await queue.pool.query('SELECT state,count(*)::int AS count FROM hub_outbox GROUP BY state');
 const review=await queue.pool.query("SELECT id,job_id,part FROM hub_outbox WHERE state='uncertain' ORDER BY sequence LIMIT 100");
 console.log(JSON.stringify({jobs:jobs.rows,outbox:outgoing.rows,uncertain:review.rows},null,2));
}finally{await queue.close();}
