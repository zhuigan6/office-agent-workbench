import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {NativeOffice} from '../packages/native-office/index.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {root,local} from '../apps/local-host/config.ts';

const journalRoot=path.join(local,'verification','native-operations-'+Date.now());
await fs.mkdir(journalRoot,{recursive:true});
const native=new NativeOffice(root,local),store=new Store(path.join(journalRoot,'operations.db')),broker=new DocumentBroker(store);
try{
  const found=await native.discover();
  const write=process.argv.includes('--write');
  const required=['native-word-test.docx','native-excel-test.xlsx','native-ppt-test.pptx'];
  for(const name of required){
    const expected=path.join(local,'host-fixtures',name).toLowerCase();
    assert.ok(found.documents.some(doc=>path.resolve(doc.location).toLowerCase()===expected),`Open the isolated fixture ${name} manually. No documents were modified.`);
  }
  const report:any={checkedAt:new Date().toISOString(),mode:write?'write-and-restore':'read-only',discovered:found.documents.map(d=>({name:d.name,kind:d.kind})),checks:[]};
  for(const doc of found.documents){
    if(doc.kind==='excel'&&path.resolve(doc.location).toLowerCase()===path.join(local,'host-fixtures','native-excel-test.xlsx').toLowerCase()){
      const host=native.host(doc);broker.attach(host);
      const before=await broker.read(host.binding.documentId,'Sheet1','B1:B2');
      report.checks.push({name:'Excel native bounded read',passed:true});
      if(process.argv.includes('--write')){
        const edit={documentId:host.binding.documentId,sheet:'Sheet1',range:'B1:B2',operationId:'native-excel-formula',expectedRevision:before.revision,formulas:[['=SUM(A1:A2)'],['=B1*2']],numberFormat:[['0.00'],['0.00']]};
        const result=await broker.write(edit);assert.equal(result.status,'applied',JSON.stringify(result.result));
        const after=await broker.read(host.binding.documentId,'Sheet1','B1:B2');assert.deepEqual(after.values,[[33],[66]]);
        assert.equal((await broker.write({...edit,operationId:'native-excel-stale',values:[[0],[0]],formulas:undefined})).status,'conflict');
        const restore=await broker.write({documentId:host.binding.documentId,sheet:'Sheet1',range:'B1:B2',operationId:'native-excel-restore',expectedRevision:after.revision,formulas:before.formulas,numberFormat:before.numberFormat});
        assert.equal(restore.status,'applied',JSON.stringify(restore.result));
        report.checks.push({name:'Excel native formulas, formats, stale revision rejection and restore',passed:true});
      }
      continue;
    }
    if(doc.kind==='powerpoint'&&path.resolve(doc.location).toLowerCase()===path.join(local,'host-fixtures','native-ppt-test.pptx').toLowerCase()){
      const host=native.host(doc);broker.attach(host);
      const slides=await broker.readText(host.binding.documentId,{count:10});assert.ok(slides.sections?.length);
      const initial=await broker.readText(host.binding.documentId,{slideId:slides.sections[0].id,count:20});
      const before=initial.items.find((item:any)=>item.text==='Native PowerPoint original');assert.ok(before,'Test title missing');
      report.checks.push({name:'PowerPoint native text read',passed:true});
      if(process.argv.includes('--write')){
        const result=await broker.writeText(host.binding.documentId,{target:before.target,expectedRevision:before.revision,operationId:'native-ppt-write',text:'Native PowerPoint verified'});assert.equal(result.status,'applied',JSON.stringify(result.result));
        const after=await broker.readText(host.binding.documentId,{slideId:slides.sections[0].id,count:20});
        const changed=after.items.find((i:any)=>i.target.shapeId===before.target.shapeId);assert.equal(changed.text,'Native PowerPoint verified');
        for(const other of initial.items.filter((i:any)=>i.target.shapeId!==before.target.shapeId))assert.equal(after.items.find((i:any)=>i.target.shapeId===other.target.shapeId).text,other.text);
        assert.equal((await broker.writeText(host.binding.documentId,{target:before.target,expectedRevision:before.revision,operationId:'native-ppt-stale',text:'MUST NOT APPEAR'})).status,'conflict');
        const restore=await broker.writeText(host.binding.documentId,{target:changed.target,expectedRevision:changed.revision,operationId:'native-ppt-restore',text:before.text});assert.equal(restore.status,'applied',JSON.stringify(restore.result));
        report.checks.push({name:'PowerPoint native write, unchanged neighbour, conflict and restore',passed:true});
      }
      continue;
    }
    const expected=path.join(local,'host-fixtures','native-word-test.docx');
    if(doc.kind!=='word'||path.resolve(doc.location).toLowerCase()!==expected.toLowerCase())continue;
    const host=native.host(doc);broker.attach(host);
    const initial=await broker.readText(host.binding.documentId,{start:0,count:2});
    assert.ok(initial.items.length>0,'Test Word document has no paragraph');
    report.checks.push({name:'Word native read',passed:true});
    if(!process.argv.includes('--write'))continue;
    const before=initial.items[0];
    const changed=await broker.writeText(host.binding.documentId,{target:before.target,expectedRevision:before.revision,operationId:'native-word-proof',text:'Workbench external Word verified'});
    assert.equal(changed.status,'applied',JSON.stringify(changed.result));
    const reread=await broker.readText(host.binding.documentId,{start:0,count:2});
    assert.equal(reread.items[0].text,'Workbench external Word verified');
    if(initial.items[1])assert.equal(reread.items[1].text,initial.items[1].text);
    const conflict=await broker.writeText(host.binding.documentId,{target:before.target,expectedRevision:before.revision,operationId:'native-word-stale',text:'MUST NOT APPEAR'});
    assert.equal(conflict.status,'conflict');
    const restore=await broker.writeText(host.binding.documentId,{target:reread.items[0].target,expectedRevision:reread.items[0].revision,operationId:'native-word-restore',text:before.text});
    assert.equal(restore.status,'applied',JSON.stringify(restore.result));
    report.checks.push({name:'Word native write/read-back, stale revision rejection and restore',passed:true});
  }
  assert.equal(report.checks.length,write?6:3,'All three Office hosts must pass; partial coverage is not success.');
  await fs.mkdir(path.join(local,'verification'),{recursive:true});
  await fs.writeFile(path.join(local,'verification',write?'native-office.json':'native-office-read.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}catch(error){
  const recovery=[];
  for(const [editId,restoreId] of [['native-excel-formula','native-excel-restore'],['native-ppt-write','native-ppt-restore'],['native-word-proof','native-word-restore']]){
    const operation=store.getOperation(editId);
    if(!operation||store.getOperation(restoreId)?.status==='applied')continue;
    if(operation.status!=='applied'){recovery.push({editId,status:operation.status,action:'Inspect persistent before-state; no blind retry.'});continue;}
    try{const restored=await restoreOperation(broker,editId);recovery.push({editId,status:restored.status});}catch{recovery.push({editId,status:'manual-inspection-required'});}
  }
  await fs.writeFile(path.join(journalRoot,'failure-recovery.json'),JSON.stringify({recovery},null,2));
  throw new Error(`Native verification failed; recovery evidence retained in ${journalRoot}`,{cause:error});
}finally{await native.stop();store.close();}
