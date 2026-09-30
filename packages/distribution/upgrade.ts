import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {safeRelative,verifyPackage,sha256} from './index.ts';

async function noLinks(root:string,relative:string){
  safeRelative(relative);let current=root;
  for(const piece of relative.split('/')){
    current=path.join(current,piece);
    try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Linked installation paths are not supported');}
    catch(error:any){if(error.code!=='ENOENT')throw error;}
  }
  return current;
}
const occupied=(port:number)=>new Promise<boolean>(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port});
  const done=(value:boolean)=>{socket.destroy();resolve(value);};
  socket.once('connect',()=>done(true));socket.once('error',e=>done((e as any).code!=='ECONNREFUSED'));
  socket.setTimeout(2000,()=>done(true));
});
export async function assertOffline(root:string){
  if(process.platform==='win32'){
    const system=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    // Query only; never disable or take ownership of a different installation's task.
    const command="$ErrorActionPreference='Stop'; @(Get-ScheduledTask | Where-Object { $_.Settings.Enabled -and @($_.Actions | Where-Object WorkingDirectory -eq $env:WORKBENCH_UPGRADE_ROOT).Count -gt 0 }).Count";
    const {stdout}=await promisify(execFile)(system,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,env:{...process.env,WORKBENCH_UPGRADE_ROOT:root}});
    if(stdout.trim()!=='0')throw Error('Disable this installation\'s scheduled task with Stop-Service.ps1 before upgrading');
  }
  const file=path.join(root,'.local/config.json');
  try{
    const config=JSON.parse(await fs.readFile(file,'utf8'));
    for(const port of [config.port,config.corePort]){
      if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid configured port');
      if(await occupied(port))throw Error('Stop the installed Workbench and disable its task before upgrade or rollback');
    }
  }catch(error:any){if(error.code!=='ENOENT')throw error;}
}
type Journal={schemaVersion:1;root:string;packageVersion:string;state:string;files:{name:string;before:string|null;after:string}[]};
async function atomicReplace(file:string,bytes:Uint8Array|string){
  const temporary=file+'.upgrade-'+randomUUID();
  try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,file);}
  finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function upgradePackage(packageRoot:string,targetRoot:string){
  const source=await fs.realpath(packageRoot),target=await fs.realpath(targetRoot);
  if(source===target||source.startsWith(target+path.sep)||target.startsWith(source+path.sep))throw Error('Package staging must be outside the installation');
  const manifest=await verifyPackage(source);
  const manifestBytes=await fs.readFile(path.join(source,'package-manifest.json'));
  if(JSON.stringify(JSON.parse(manifestBytes.toString()))!==JSON.stringify(manifest))throw Error('Staged manifest changed during verification');
  if(JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')).name!=='office-agent-workbench')throw Error('Not a Workbench installation');
  await assertOffline(target);
  const names=[...Object.keys(manifest.files),'package-manifest.json'];
  for(const name of names)await noLinks(target,name);
  await noLinks(target,'upgrade-backups');
  const backup=path.join(target,'upgrade-backups',randomUUID());await fs.mkdir(backup,{recursive:true});
  const journal:Journal={schemaVersion:1,root:target,packageVersion:manifest.version,state:'prepared',files:[]};
  for(const name of names){
    let before:string|null=null;
    try{const bytes=await fs.readFile(path.join(target,name));before=sha256(bytes);const dest=path.join(backup,'before',name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes,{flag:'wx'});}
    catch(error:any){if(error.code!=='ENOENT')throw error;}
    journal.files.push({name,before,after:name==='package-manifest.json'?sha256(manifestBytes):manifest.files[name]});
  }
  const record=path.join(backup,'journal.json');
  await fs.writeFile(record,JSON.stringify(journal,null,2),{flag:'wx'});
  try{
    for(const item of journal.files){
      const bytes=await fs.readFile(path.join(source,item.name));if(sha256(bytes)!==item.after)throw Error('Staged package changed during upgrade');
      const dest=await noLinks(target,item.name);await fs.mkdir(path.dirname(dest),{recursive:true});await atomicReplace(dest,bytes);
    }
    journal.state='installed';await atomicReplace(record,JSON.stringify(journal,null,2));
    return {backup,version:manifest.version,files:journal.files.length};
  }catch(error){journal.state='interrupted';await atomicReplace(record,JSON.stringify(journal,null,2));throw Error(`Upgrade interrupted. Preserve data and inspect rollback journal: ${record}`,{cause:error});}
}
export async function rollbackPackage(targetRoot:string,backupId:string){
  if(!/^[a-f0-9-]{36}$/.test(backupId))throw Error('Invalid backup ID');
  const root=await fs.realpath(targetRoot),relative=`upgrade-backups/${backupId}`;
  const backup=await noLinks(root,relative),record=path.join(backup,'journal.json');
  const journal=JSON.parse(await fs.readFile(record,'utf8')) as Journal;
  if(journal.schemaVersion!==1||journal.root!==root||!['prepared','installed','interrupted'].includes(journal.state))throw Error('Invalid rollback journal');
  await assertOffline(root);
  for(const item of journal.files){
    const dest=await noLinks(root,item.name);
    let hash:string|null=null;try{hash=sha256(await fs.readFile(dest));}catch(error:any){if(error.code!=='ENOENT')throw error;}
    if(hash!==item.before&&hash!==item.after)throw Error('A deployed file changed after upgrade; preserve it before rollback: '+item.name);
    if(item.before){
      await noLinks(backup,'before/'+item.name);
      if(sha256(await fs.readFile(path.join(backup,'before',item.name)))!==item.before)throw Error('Backup hash mismatch');
    }
  }
  for(const item of journal.files){
    const dest=await noLinks(root,item.name);
    if(item.before)await atomicReplace(dest,await fs.readFile(path.join(backup,'before',item.name)));
    else await fs.unlink(dest).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  journal.state='rolled-back';await atomicReplace(record,JSON.stringify(journal,null,2));return {rolledBack:true,backup};
}
