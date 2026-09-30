import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {filesBelow,sha256} from '../packages/distribution/index.ts';
import {assertBuildDestination} from '../packages/distribution/build-inputs.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2])throw Error('Provide a new source export directory.');
const destination=path.resolve(process.argv[2]);assertBuildDestination(root,destination);
const inputs=['.github','.gitignore','apps/cli','apps/local-host','apps/workbench','packages','tests','licenses','README.md','CHANGELOG.md','SECURITY.md','CONTRIBUTING.md','LICENSE','THIRD-PARTY-NOTICES.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','upstreams.lock.json'];
const scripts=['Build-Source.ts','Build-Package.ts','Manage-Package.ts','Initialize-Local.ps1','Install-Service.ps1','Start-Service.ps1','Stop-Service.ps1','Open-Workbench.ps1','Start-NativeTerminal.ps1','Protect-Data.ps1','Renew-Certificate.ps1','Rotate-UiToken.ts','Verify-ComplexDocuments.ts','Verify-Templates.ts','Verify-NativeOffice.ts','Verify-UnsavedSnapshots.ts','Benchmark-ModelContext.ts','Inspect-NativeRuntime.ts','Verify-CodexRpc.ts','Verify-CodexRemote.ts','Verify-OfficeHelpCache.ts','Verify-LiveHelpCache.ts'];
inputs.push(...[...scripts,'Inspect-OfficeWindows.ps1','Prepare-NativeFixtures.ts','Verify-McpTemplate.ts','Verify-DataImport.ts','Verify-WordParagraphs.ts','Verify-LiveTools.ts','Verify-ManagedLiveTools.ts'].map(name=>'scripts/'+name));
inputs.push(...(await filesBelow(path.join(root,'docs'))).filter(name=>!['PROGRESS.md','DEPLOYMENT.md'].includes(name)).map(name=>'docs/'+name));
const names:string[]=[];
for(const input of inputs){const stat=await fs.lstat(path.join(root,input));if(stat.isSymbolicLink())throw Error('Linked source input');if(stat.isDirectory())names.push(...(await filesBelow(path.join(root,input))).map(name=>input+'/'+name));else names.push(input);}
let secrets:string[]=[];
try{const cfg=JSON.parse(await fs.readFile(path.join(root,'.local/config.json'),'utf8'));secrets=[cfg.uiToken,cfg.coreSecret,cfg.pfxPassword].filter(value=>typeof value==='string'&&value.length>12);}catch(error:any){if(error.code!=='ENOENT')throw error;}
await fs.mkdir(destination,{recursive:false});
const manifest:Record<string,string>={};
for(const name of names.sort()){
  const bytes=await fs.readFile(path.join(root,name));if(secrets.some(secret=>bytes.includes(Buffer.from(secret))))throw Error('Known local credential detected in source export');
  await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});await fs.writeFile(path.join(destination,name),bytes,{flag:'wx'});manifest[name]=sha256(bytes);
}
await fs.writeFile(path.join(destination,'SOURCE-MANIFEST.json'),JSON.stringify({version:1,files:manifest},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,files:names.length,privateConfigurationIncluded:false,publication:false}));
