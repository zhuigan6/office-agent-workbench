import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {filesBelow,sha256,verifyPackage,type Manifest} from '../packages/distribution/index.ts';
import {buildInputs,assertBuildDestination} from '../packages/distribution/build-inputs.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.resolve(process.argv[2] || path.join(root,'.local','packages','build-'+Date.now()));
assertBuildDestination(root,destination);
const inputs=await buildInputs(root,process.env);
const lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8'));
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const secrets=inputs.secrets;
if(sha256(await fs.readFile(inputs.officecli))!==lock.officecli.binarySha256)throw Error('OfficeCLI does not match pinned binary');
if(sha256(await fs.readFile(inputs.aioncore))!==lock.aioncore.binarySha256)throw Error('AionCore does not match pinned binary');
const resources=inputs.resources;
await fs.access(path.join(resources,'manifest.json'));
await fs.mkdir(path.dirname(destination),{recursive:true});
await fs.mkdir(destination,{recursive:false});
async function copy(source:string,target:string){
  const stat=await fs.lstat(source);
  if(stat.isSymbolicLink())throw Error('Refusing linked package input: '+source);
  if(stat.isDirectory()){
    await fs.mkdir(target,{recursive:true});
    for(const name of await filesBelow(source))await copy(path.join(source,name),path.join(target,name));
  }else{
    const bytes=await fs.readFile(source);
    if(secrets.some((secret:string)=>bytes.includes(Buffer.from(secret))))throw Error('Private credential detected in package input');
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});
  }
}
// An explicit allowlist is safer than trying to enumerate all private exclusions.
for(const name of ['apps/cli','apps/local-host','apps/workbench','packages','dist','node_modules','tests','package.json','package-lock.json','tsconfig.json','vite.config.ts','upstreams.lock.json','README.md','CHANGELOG.md','SECURITY.md','CONTRIBUTING.md','THIRD-PARTY-NOTICES.md','licenses']){
  await copy(path.join(root,name),path.join(destination,name));
}
for(const name of await filesBelow(path.join(root,'docs'))){
  if(name==='PROGRESS.md')continue;
  await copy(path.join(root,'docs',name),path.join(destination,'docs',name));
}
for(const name of ['Start-Service.ps1','Stop-Service.ps1','Install-Service.ps1','Initialize-Local.ps1','Open-Workbench.ps1','Start-NativeTerminal.ps1','Inspect-OfficeWindows.ps1','Manage-Package.ts','Protect-Data.ps1','Renew-Certificate.ps1','Rotate-UiToken.ts','Verify-ComplexDocuments.ts','Verify-Templates.ts','Verify-DataImport.ts'])await copy(path.join(root,'scripts',name),path.join(destination,'scripts',name));
await copy(path.join(root,'LICENSE'),path.join(destination,'LICENSE'));
await copy(process.execPath,path.join(destination,'runtime/node/node.exe'));
await copy(inputs.aioncore,path.join(destination,'runtime/aioncore/aioncore.exe'));
await copy(inputs.officecli,path.join(destination,'runtime/officecli/officecli.exe'));
await copy(resources,path.join(destination,'runtime/aioncore/managed-resources'));
const manifest:Manifest={schemaVersion:1,version:pkg.version,runtimes:{node:process.version,aioncore:lock.aioncore.version,officecli:lock.officecli.version},files:{}};
for(const name of await filesBelow(destination))manifest.files[name]=sha256(await fs.readFile(path.join(destination,name)));
await fs.writeFile(path.join(destination,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await verifyPackage(destination);
console.log(JSON.stringify({directory:destination,version:manifest.version,files:Object.keys(manifest.files).length,verified:true}));
