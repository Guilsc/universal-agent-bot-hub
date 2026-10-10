import { createCodexRunner } from './codex-runner.js';
const run=createCodexRunner({
 root:process.env.WORKER_ROOT||'work/codex-smoke',
 executable:process.env.CODEX_BIN,
 authHome:process.env.CODEX_AUTH_HOME,
 timeoutMs:45000
});
try {
 const result=await run({session:'development-smoke',payload:{text:'Respond with only OK. Do not run tools.'}});
 if(result.text.trim()!=='OK')throw new Error('Unexpected smoke response');
 console.log('Live Codex smoke passed');
} catch(error) {console.error(error.message);process.exitCode=1;}
