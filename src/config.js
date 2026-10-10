import { readFile } from 'node:fs/promises';
export function loadRunnerConfig(env=process.env) {
 const sandbox=env.CODEX_SANDBOX||'read-only',webSearch=env.CODEX_WEB_SEARCH||'disabled';
 if(!['read-only','workspace-write'].includes(sandbox))throw new Error('Invalid CODEX_SANDBOX');
 if(!['disabled','cached','live'].includes(webSearch))throw new Error('Invalid CODEX_WEB_SEARCH');
 const timeoutMs=Number(env.CODEX_TIMEOUT_MS||120000),historyTurns=Number(env.HISTORY_TURNS||6);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000)throw new Error('Invalid CODEX_TIMEOUT_MS');
 if(!Number.isSafeInteger(historyTurns)||historyTurns<1||historyTurns>50)throw new Error('Invalid HISTORY_TURNS');
 const reasoningEffort=env.CODEX_REASONING_EFFORT||'medium';
 if(!['low','medium','high','xhigh'].includes(reasoningEffort))throw new Error('Invalid CODEX_REASONING_EFFORT');
 return {sandbox,webSearch,timeoutMs,historyTurns,reasoningEffort};
}
export async function readSecret(env,name,{required=true}={}) {
 if(env[name]&&env[`${name}_FILE`])throw new Error(`Configure only ${name} or ${name}_FILE`);
 const value=env[`${name}_FILE`]?(await readFile(env[`${name}_FILE`],'utf8')).trim():env[name]?.trim();
 if(required&&!value)throw new Error(`${name} or ${name}_FILE required`);
 return value;
}
export async function loadConfig(env=process.env) {
 const allowedUsers=(env.TELEGRAM_ALLOWED_USERS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const allowedChats=(env.TELEGRAM_ALLOWED_CHATS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(!allowedUsers.length||!allowedUsers.every(x=>/^\d+$/.test(x)))throw new Error('TELEGRAM_ALLOWED_USERS must contain numeric user IDs');
 if(!allowedChats.every(x=>/^-?\d+$/.test(x)))throw new Error('TELEGRAM_ALLOWED_CHATS must contain numeric chat IDs');
 const mode=env.TELEGRAM_MODE||'polling';if(!['polling','webhook'].includes(mode))throw new Error('Invalid TELEGRAM_MODE');
 const webhookSecret=await readSecret(env,'TELEGRAM_WEBHOOK_SECRET',{required:mode==='webhook'});
 if(mode==='webhook'&&!/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret))throw new Error('Webhook secret must contain 32-256 URL-safe characters');
 const port=Number(env.PORT||3000);if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
 const runner=loadRunnerConfig(env);
 return {
  databaseUrl:await readSecret(env,'DATABASE_URL'),token:await readSecret(env,'TELEGRAM_BOT_TOKEN'),
  username:env.TELEGRAM_BOT_USERNAME||'guilherme_local_codex_agent_bot',
  runner,routes:{allowedUsers,allowedChats,agent:env.AGENT_ID||'codex-default',username:env.TELEGRAM_BOT_USERNAME||'guilherme_local_codex_agent_bot',notifications:env.TELEGRAM_PROGRESS!=='false'},mode,webhookSecret,port,
  host:env.HOST||'127.0.0.1',workerRoot:env.WORKER_ROOT||'work/worker',authHome:env.CODEX_AUTH_HOME,executable:env.CODEX_BIN
 };
}
