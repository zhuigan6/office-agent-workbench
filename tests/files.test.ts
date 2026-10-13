import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync,strToU8 } from 'fflate';
import { FileWorkspace,validateFile,validateBatch } from '../packages/document-workspace/files.ts';
import { Store } from '../packages/document-workspace/store.ts';
import { OfficeCli } from '../packages/officecli-adapter/index.ts';
const workbook=()=>Buffer.from(zipSync({'[Content_Types].xml':strToU8('<Types/>'),'xl/workbook.xml':strToU8('<workbook/>')}));

test('pinned OfficeCLI rejects a changed executable before launching it',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-engine-'));
  try{
    const binary=path.join(root,'not-executed.exe');await fs.writeFile(binary,'changed executable');
    const engine=new OfficeCli(binary,root,'0'.repeat(64));
    await assert.rejects(engine.run(['--version']),{code:'ENGINE_VERSION_CHANGED'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('upload rejects traversal, mismatched Office packages and invalid image signatures',()=>{
  assert.throws(()=>validateFile('../secret.xlsx',workbook()));
  assert.throws(()=>validateFile('wrong.docx',workbook()));
  assert.throws(()=>validateFile('photo.png',Buffer.from('not a png')));
  assert.throws(()=>validateFile('macro.xlsx',Buffer.from(zipSync({'[Content_Types].xml':strToU8('x'),'xl/workbook.xml':strToU8('x'),'xl/vbaProject.bin':strToU8('x')}))));
  assert.equal(validateFile('测试.xlsx',workbook()),'xlsx');
});
test('original engine structured inspection remains renderable when its output exceeds the model budget',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-inspection-')),store=new Store(':memory:');
  const rows=Array.from({length:100},(_,i)=>({path:'/Sheet1/A'+(i+1),type:'cell',text:'x'.repeat(1000)}));
  const fake={async run(args:string[]){assert.equal(args[0],'query');assert.equal(args.at(-1),'--json');return {code:0,stdout:JSON.stringify({success:true,data:{results:rows}}),stderr:''};}} as OfficeCli;
  try{const workspace=new FileWorkspace(store,root,fake),file=await workspace.put('input.xlsx',workbook());workspace.attach('task',file.id);
    const result:any=await workspace.command({action:'inspect',command:'query',fileId:file.id,args:['cell']},'task');assert.equal(result.truncated,true);assert.equal(typeof result.output,'object');assert.ok(result.output.data.results.length>0);assert.ok(JSON.stringify(result.output).length<=24000);assert.ok(result.narrowing);assert.deepEqual(result.output.data.results,rows.slice(0,result.output.returnedResultCount));
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('batch excludes process control, file overrides and arbitrary asset paths',()=>{
  assert.throws(()=>validateBatch([{command:'install'}]));
  assert.throws(()=>validateBatch([{command:'set',file:'C:/private.xlsx',path:'/'}]));
  assert.throws(()=>validateBatch([{command:'add',parent:'/',props:{src:'C:/private.png'}}]));
  assert.throws(()=>validateBatch([{command:'remove',path:'../../private'}]));
  assert.equal(validateBatch([{command:'set',path:'/Sheet1/A1',props:{value:'42'}}]).length,1);
});
test('failed staged batches retain full local evidence and compact receipts without replay or publishing',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-batch-failure-')),store=new Store(':memory:');let batches=0;
  const output={success:false,data:{summary:{total:2,executed:2,succeeded:1,failed:1,skipped:0,atomicRolledBack:true},results:[{index:0,success:true,output:'local-first-step'},{index:1,success:false,error:'failure '+('x'.repeat(6000)),code:'not_found'}]}};
  const fake={async run(args:string[]){assert.equal(args[0],'batch');batches++;return {code:1,stdout:JSON.stringify(output),stderr:''};}} as OfficeCli;
  try{const files=new FileWorkspace(store,root,fake),original=workbook(),file=await files.put('source.xlsx',original);files.attach('task',file.id);
    const request={action:'batch',fileId:file.id,operationId:'fail',commands:[{command:'set',path:'/Sheet1/A1',props:{value:'1'}},{command:'set',path:'/Sheet1/A2',props:{value:'2'}}]};
    await assert.rejects(files.command(request,'task'),(e:any)=>{assert.equal(e.code,'BATCH_FAILED');assert.equal(e.receipt.copyPublished,false);assert.equal(e.receipt.batch.failedSteps[0].index,1);assert.ok(JSON.stringify(e.receipt).length<2000);return true;});
    assert.deepEqual((store.getOperation('task_fail')!.result as any).execution.output,output);assert.equal(files.list('task').length,1);assert.deepEqual(await fs.readFile(files.filename(file.id)),original);
    await assert.rejects(files.command(request,'task'),(e:any)=>{assert.equal(e.code,'OPERATION_STATE');assert.equal(e.receipt.replayed,false);return true;});assert.equal(batches,1);assert.equal((await fs.readdir(root)).some(name=>name.startsWith('working-')),false);
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('a failed step cannot publish a copy even if a corrupt summary reports zero failures',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-batch-count-')),store=new Store(':memory:');
  const fake={async run(_args:string[]){return {code:0,stdout:JSON.stringify({success:true,data:{summary:{total:1,executed:1,succeeded:1,failed:0,skipped:0},results:[{index:0,success:false,error:'actual failure'}]}}),stderr:''};}} as OfficeCli;
  try{const files=new FileWorkspace(store,root,fake),file=await files.put('source.xlsx',workbook());await assert.rejects(files.command({action:'batch',fileId:file.id,operationId:'bad-count',commands:[{command:'get',path:'/'}]}),{code:'BATCH_FAILED'});assert.equal(files.list().length,1);
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('file scope, immutable copies, failed duplicate handling and content tampering',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-files-')),store=new Store(':memory:');let batches=0;
  const fake={async run(args:string[]){if(args[0]==='batch'){batches++;return {code:0,stdout:JSON.stringify({success:true,data:{summary:{failed:0}}}),stderr:''};}return {code:0,stdout:'{"success":true}',stderr:''};}} as OfficeCli;
  const workspace=new FileWorkspace(store,root,fake);
  try {
    const file=await workspace.put('input.xlsx',workbook());workspace.attach('allowed',file.id);
    assert.throws(()=>workspace.requireAccess('other',file.id));
    const request={action:'batch',fileId:file.id,operationId:'once',commands:[{command:'set',path:'/Sheet1/A1',props:{value:'42'}}]};
    const result=await workspace.command(request,'allowed');assert.notEqual(result.file.id,file.id);assert.equal(result.file.sourceId,file.id);
    assert.equal(result.file.version,2);assert.equal(result.file.name,'input-v2.xlsx');assert.equal(result.file.rootId,file.id);assert.equal(result.changes.unchanged,2);
    assert.equal((await workspace.command(request,'allowed')).file.id,result.file.id);assert.equal(batches,1);
    await assert.rejects(workspace.command({...request,commands:[{command:'remove',path:'/Sheet1'}]},'allowed'),/different arguments/);
    await assert.rejects(workspace.command({action:'create',format:'../../escape',operationId:'bad'}),/Choose|Create/);
    await fs.appendFile(workspace.filename(file.id),'changed');await assert.rejects(workspace.checkedFile(file.id),/changed outside/);
  } finally {store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('template merge scopes the source, stages only inline data, preserves original and replays receipt',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-merge-')),store=new Store(':memory:');let merges=0;
  const fake={async run(args:string[]){if(args[0]==='merge'){merges++;assert.deepEqual(JSON.parse(await fs.readFile(args[4],'utf8')),{name:'Example'});await fs.copyFile(args[1],args[2]);}return {code:0,stdout:'{"success":true}',stderr:''};}} as OfficeCli;
  const workspace=new FileWorkspace(store,root,fake);
  try{
    const original=workbook();const file=await workspace.put('template.xlsx',original);workspace.attach('allowed',file.id);
    const request={action:'merge',fileId:file.id,operationId:'merge-once',data:{name:'Example'}};
    await assert.rejects(workspace.command(request,'other'),{code:'FILE_SCOPE'});
    for(const data of ['C:/secret.json',{},[],{nested:{path:'secret'}},{name:'x'.repeat(64001)}])await assert.rejects(workspace.command({...request,data},'allowed'),{code:'MERGE_DATA'});
    const result=await workspace.command(request,'allowed');assert.equal(result.file.version,2);assert.equal(result.file.sourceId,file.id);
    assert.equal((await workspace.command(request,'allowed')).file.id,result.file.id);assert.equal(merges,1);
    assert.deepEqual(await fs.readFile(workspace.filename(file.id)),original);
    assert.equal((await fs.readdir(root)).some(name=>name.includes('working-')),false);
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
test('CSV import requires both scoped files and leaves target/data originals unchanged',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-import-')),store=new Store(':memory:');let imports=0;
  const fake={async run(args:string[]){if(args[0]==='import'){imports++;assert.equal(await fs.readFile(args[3],'utf8'),'Name,Amount\nNorth,120');assert.equal(args[2],'/Sheet1');}return {code:0,stdout:'{"success":true}',stderr:''};}} as OfficeCli;
  const workspace=new FileWorkspace(store,root,fake);
  try{
    const original=workbook();const book=await workspace.put('original.xlsx',original),data=await workspace.put('data.csv',Buffer.from('Name,Amount\nNorth,120'));
    workspace.attach('task',book.id);const request={action:'import',fileId:book.id,dataFileId:data.id,sheet:'/Sheet1',operationId:'import-once'};
    await assert.rejects(workspace.command(request,'task'),{code:'FILE_SCOPE'});assert.equal(imports,0);
    workspace.attach('task',data.id);const output=await workspace.command(request,'task');assert.equal(output.file.sourceId,book.id);assert.equal(output.file.version,2);
    assert.equal((await workspace.command(request,'task')).file.id,output.file.id);assert.equal(imports,1);
    assert.deepEqual(await fs.readFile(workspace.filename(book.id)),original);assert.equal(await fs.readFile(workspace.filename(data.id),'utf8'),'Name,Amount\nNorth,120');
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
