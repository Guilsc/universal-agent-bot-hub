import { readdir,stat } from 'node:fs/promises';
import { join } from 'node:path';

async function file(path) {
 try {const info=await stat(path);return info.isFile()?info:undefined;}catch(error){
  if(['ENOENT','ENOTDIR'].includes(error.code))return undefined;
  throw error;
 }
}

export async function resolveCodexExecutable({executable,env=process.env,platform=process.platform}={}) {
 if(executable)return executable;
 if(env.CODEX_BIN)return env.CODEX_BIN;
 if(platform!=='win32')return 'codex';
 const pathValue=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]||'';
 for(const directory of pathValue.split(';').filter(Boolean)) {
  const candidate=join(directory.replace(/^"|"$/g,''),'codex.exe');
  if(await file(candidate))return candidate;
 }
 const local=env.LOCALAPPDATA||(env.USERPROFILE?join(env.USERPROFILE,'AppData','Local'):undefined);
 if(local) {
  const root=join(local,'OpenAI','Codex','bin');
  let entries=[];
  try {entries=await readdir(root,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  const candidates=[];
  for(const entry of entries.filter(entry=>entry.isDirectory())) {
   const path=join(root,entry.name,'codex.exe');
   const info=await file(path);
   if(info)candidates.push({path,modified:info.mtimeMs});
  }
  candidates.sort((a,b)=>b.modified-a.modified||a.path.localeCompare(b.path));
  if(candidates.length)return candidates[0].path;
 }
 throw new Error('Codex executable not found. Install Codex desktop or set CODEX_BIN to codex.exe.');
}
