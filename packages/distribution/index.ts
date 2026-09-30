import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export type Manifest = {schemaVersion:1; version:string; files:Record<string,string>; runtimes?:{node:string; aioncore:string; officecli:string}};
export const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function safeRelative(name:string) {
  if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..')||name.includes(':'))throw Error('Unsafe package path');
  if(name.split('/').some(p=>['.local','.git','.env','.npm-cache','test-results'].includes(p.toLowerCase())))throw Error('Private package path');
  return name;
}
export async function filesBelow(root:string):Promise<string[]> {
  const results:string[]=[];
  async function walk(relative:string){
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
      const name=relative?relative+'/'+entry.name:entry.name;
      const stat=await fs.lstat(path.join(root,name));
      if(stat.isSymbolicLink())throw Error('Package cannot contain links: '+name);
      if(stat.isDirectory())await walk(name);
      else if(stat.isFile())results.push(safeRelative(name));
      else throw Error('Unsupported package entry: '+name);
    }
  }
  await walk('');return results.sort();
}
export async function verifyPackage(root:string):Promise<Manifest>{
  const m=JSON.parse(await fs.readFile(path.join(root,'package-manifest.json'),'utf8')) as Manifest;
  if(m.schemaVersion!==1||typeof m.version!=='string'||!m.files||typeof m.files!=='object')throw Error('Invalid package manifest');
  const actual=(await filesBelow(root)).filter(p=>p!=='package-manifest.json');
  if(actual.length!==Object.keys(m.files).length)throw Error('Package contains missing or unexpected files');
  for(const name of actual){
    safeRelative(name);
    if(!/^[a-f0-9]{64}$/.test(m.files[name]||'')||sha256(await fs.readFile(path.join(root,name)))!==m.files[name])throw Error('Package checksum mismatch: '+name);
  }
  return m;
}
