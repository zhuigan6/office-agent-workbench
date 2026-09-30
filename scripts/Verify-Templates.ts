import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root,loadConfig} from '../apps/local-host/config.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {FileWorkspace} from '../packages/document-workspace/files.ts';
import {OfficeCli} from '../packages/officecli-adapter/index.ts';

const lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8'));
const output=path.join(root,'.local/verification','templates-'+Date.now());await fs.mkdir(output,{recursive:true});
const store=new Store(':memory:'),engine=new OfficeCli(process.env.WORKBENCH_OFFICECLI||loadConfig().officecli,output,lock.officecli.binarySha256),workspace=new FileWorkspace(store,output,engine);
const cases=[{format:'docx',commands:[{command:'add',parent:'/body',type:'paragraph',props:{text:'Hello {{name}}'}}]},
  {format:'xlsx',commands:[{command:'set',path:'/Sheet1/A1',props:{value:'Hello {{name}}'}}]},
  {format:'pptx',commands:[{command:'add',parent:'/',type:'slide',props:{title:'Hello {{name}}',text:'Editable template'}}]}];
const reports=[];
try{
  for(const scenario of cases){
    const original=await workspace.command({action:'create',format:scenario.format,commands:scenario.commands,operationId:'template-'+scenario.format},'template-tests');
    const before=await fs.readFile(workspace.filename(original.file.id));
    const merged=await workspace.command({action:'merge',fileId:original.file.id,data:{name:'Template Test'},operationId:'merge-'+scenario.format},'template-tests');
    assert.equal(merged.validation.exitCode,0);assert.equal(merged.file.sourceId,original.file.id);
    const result=await workspace.command({action:'inspect',fileId:merged.file.id,command:'view',args:['text']},'template-tests');
    assert.match(JSON.stringify(result.output),/Hello Template Test/);assert.doesNotMatch(JSON.stringify(result.output),/\{\{name\}\}/);
    assert.deepEqual(await fs.readFile(workspace.filename(original.file.id)),before);
    await fs.copyFile(workspace.filename(merged.file.id),path.join(output,'merged.'+scenario.format));
    reports.push({format:scenario.format,validated:true,replacementReadback:true,originalPreserved:true});
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({reports},null,2));console.log(JSON.stringify({passed:true,output,reports}));
}finally{store.close();}
