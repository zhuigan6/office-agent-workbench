import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {root,local,loadConfig} from '../apps/local-host/config.ts';
import {httpsTransport} from '../packages/client/index.ts';
import {NativeOffice} from '../packages/native-office/index.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {OfficeCli} from '../packages/officecli-adapter/index.ts';

if(!process.argv.includes('--write-and-restore'))throw Error('Explicit --write-and-restore is required; only named native fixtures are allowed.');
const cfg=loadConfig(),ca=new X509Certificate(await fs.readFile(path.join(local,'server.cer'))).toString();
for(const route of ['/api/conversations','/api/operations']){
  const response=await httpsTransport({url:new URL(`https://localhost:${cfg.port}${route}`),method:'GET',headers:{Authorization:`Bearer ${cfg.uiToken}`},ca,timeoutMs:5000});
  assert.equal(response.status,200);const rows=JSON.parse(response.body.toString());
  if(rows.some((row:any)=>row.turn||['running','queued'].includes(row.status)))throw Error('Active tasks or writes; do not run native fixture acceptance now.');
}
const output=path.join(local,'verification','unsaved-snapshots-'+Date.now());await fs.mkdir(output,{recursive:true});
const native=new NativeOffice(root,output),store=new Store(path.join(output,'operations.db')),broker=new DocumentBroker(store);
const lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8')),engine=new OfficeCli(cfg.officecli,output,lock.officecli.binarySha256);
const reports:any[]=[];
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
try{
  const discovery=await native.discover();
  const expected=['native-excel-test.xlsx','native-ppt-test.pptx'].map(name=>path.resolve(local,'host-fixtures',name));
  const fixtures=expected.map(location=>{const doc=discovery.documents.find(item=>path.resolve(item.location).toLowerCase()===location.toLowerCase());assert.ok(doc,`Open dedicated fixture ${path.basename(location)}; no edits issued.`);return doc;});
  for(const doc of fixtures){
    const original=await fs.readFile(doc.location);await fs.writeFile(path.join(output,'before-'+doc.name),original,{flag:'wx'});
    const host=native.host(doc);broker.attach(host);const id=host.binding.documentId,operationId='snapshot-'+doc.kind;
    let before:any,target:any,readInput:any;
    if(doc.kind==='excel')before=await broker.read(id,'Sheet1','B1');
    else{
      const slides=await broker.readText(id,{count:10});assert.ok(slides.sections?.length);
      readInput={slideId:slides.sections[0].id,count:20};const text=await broker.readText(id,readInput);
      before=text.items.find((item:any)=>item.text==='Native PowerPoint original');assert.ok(before,'Dedicated title missing');target=before.target;
    }
    const report:any={kind:doc.kind,originalDiskHash:hash(original),restored:false};reports.push(report);
    try{
      const marker='UNSAVED_SNAPSHOT_'+doc.kind.toUpperCase();
      const edit=doc.kind==='excel'?await broker.write({documentId:id,sheet:'Sheet1',range:'B1',values:[[marker]],operationId,expectedRevision:before.revision}):await broker.writeText(id,{target,text:marker,operationId,expectedRevision:before.revision});
      assert.equal(edit.status,'applied',JSON.stringify(edit.result));
      assert.equal(hash(await fs.readFile(doc.location)),report.originalDiskHash,'Source was saved externally during test');
      const snapshot=await broker.snapshot(id),snapshotFile=path.join(output,'unsaved.'+(doc.kind==='excel'?'xlsx':'pptx'));
      await fs.writeFile(snapshotFile,Buffer.from(snapshot.base64,'base64'),{flag:'wx'});
      const read=await engine.run(doc.kind==='excel'?['get',snapshotFile,'/Sheet1/B1','--json']:['view',snapshotFile,'text','--json']);
      assert.equal(read.code,0);assert.ok(read.stdout.includes(marker),'Snapshot omitted unsaved marker');report.snapshotIncludesUnsaved=true;
    }finally{
      const operation=store.getOperation(operationId);
      if(operation?.status==='applied'){
        const restore=await restoreOperation(broker,operationId);assert.equal(restore.status,'applied','Guarded restore failed; inspect persistent operation log before any retry.');
        const after=doc.kind==='excel'?await broker.read(id,'Sheet1','B1'):(await broker.readText(id,readInput)).items.find((item:any)=>item.target.shapeId===target.shapeId);
        assert.equal(after.revision,before.revision);report.restored=true;
      }
      report.sourceDiskUnchanged=hash(await fs.readFile(doc.location))===report.originalDiskHash;
      await fs.writeFile(path.join(output,'report.json'),JSON.stringify({reports,note:'No save. Content restored; Office dirty indicator may remain set. Unknown writes are not blindly retried; persistent operation log retained.'},null,2));
    }
    assert.equal(report.sourceDiskUnchanged,true);
  }
  console.log(JSON.stringify({passed:reports.length===2&&reports.every(row=>row.restored&&row.snapshotIncludesUnsaved&&row.sourceDiskUnchanged),output,reports}));
}finally{await native.stop();store.close();}
