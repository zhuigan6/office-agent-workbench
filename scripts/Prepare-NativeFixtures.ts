import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root,local,loadConfig} from '../apps/local-host/config.ts';
import {OfficeCli} from '../packages/officecli-adapter/index.ts';

const output=path.resolve(process.argv[2]||path.join(local,'host-fixtures'));
const cases=[{name:'native-word-test.docx',commands:[{command:'add',parent:'/body',type:'paragraph',props:{text:'Native Word original'}},{command:'add',parent:'/body',type:'paragraph',props:{text:'Unchanged neighbouring paragraph'}}]},
  {name:'native-excel-test.xlsx',commands:[{command:'set',path:'/Sheet1/A1',props:{value:'11'}},{command:'set',path:'/Sheet1/A2',props:{value:'22'}}]},
  {name:'native-ppt-test.pptx',commands:[{command:'add',parent:'/',type:'slide',props:{title:'Native PowerPoint original',text:'Unchanged neighbouring text'}}]}];
for(const item of cases){try{await fs.lstat(path.join(output,item.name));throw Error('Existing fixture is never overwritten: '+item.name);}catch(error:any){if(error.code!=='ENOENT')throw error;}}
const lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8'));
const staging=path.join(local,'verification','fixture-build-'+Date.now());await fs.mkdir(staging,{recursive:true});
const engine=new OfficeCli(process.env.WORKBENCH_OFFICECLI||loadConfig().officecli,staging,lock.officecli.binarySha256);
for(const item of cases){const file=path.join(staging,item.name);assert.equal((await engine.run(['create',file,'--json'])).code,0);const batch=await engine.run(['batch',file,'--json'],JSON.stringify(item.commands));assert.equal(batch.code,0);assert.notEqual(JSON.parse(batch.stdout).success,false);assert.equal((await engine.run(['validate',file,'--json'])).code,0);}
await fs.mkdir(output,{recursive:true});
for(const item of cases)await fs.copyFile(path.join(staging,item.name),path.join(output,item.name),fs.constants.COPYFILE_EXCL);
console.log(JSON.stringify({output,files:cases.map(item=>item.name),officeStarted:false,existingFilesReplaced:false}));
