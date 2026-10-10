import { readFile } from 'node:fs/promises';
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
 return {
  databaseUrl:await readSecret(env,'DATABASE_URL'),token:await readSecret(env,'TELEGRAM_BOT_TOKEN'),
  username:env.TELEGRAM_BOT_USERNAME||'guilherme_local_codex_agent_bot',
  routes:{allowedUsers,allowedChats,agent:env.AGENT_ID||'codex-default'},mode,webhookSecret,port,
  host:env.HOST||'127.0.0.1',workerRoot:env.WORKER_ROOT||'work/worker',authHome:env.CODEX_AUTH_HOME,executable:env.CODEX_BIN
 };
}
