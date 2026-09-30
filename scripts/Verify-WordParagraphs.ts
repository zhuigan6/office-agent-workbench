import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NativeOffice} from '../packages/native-office/index.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {formatWordSelection} from '../packages/document-workspace/word-format.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {root,local} from '../apps/local-host/config.ts';

const directory=path.join(local,'verification','word-paragraphs-'+Date.now());
await fs.mkdir(directory,{recursive:true});
const native=new NativeOffice(root,local),store=new Store(path.join(directory,'operations.db')),broker=new DocumentBroker(store);
const report:any={checks:[],documentSaveIssued:false,modelTurnIssued:false};
let pending:string|undefined;
const filename=path.resolve(local,'host-fixtures','native-word-test.docx');
const fileHash=async()=>createHash('sha256').update(await fs.readFile(filename)).digest('hex');
try{
  const found=await native.discover(),matches=found.documents.filter(doc=>path.resolve(doc.location).toLowerCase()===filename.toLowerCase());
  assert.equal(matches.length,1,'Open exactly one dedicated native-word-test.docx fixture; no other file is eligible.');
  const host=native.host(matches[0]);broker.attach(host);
  const originalFileHash=await fileHash(),text=await broker.readText(host.binding.documentId,{count:10});
  assert.deepEqual(text.items.map((item:any)=>item.text),['Native Word original','Keep this paragraph unchanged']);
  const fields=['bold','size'],paragraphFields=['alignment','spaceBefore','spaceAfter','leftIndent','rightIndent','firstLineIndent','keepWithNext','keepTogether'];
  const partial=await native.resolveTarget(host.binding.documentId,{kind:'word',text:'Native Word'});
  assert.equal(partial.status,'resolved');
  await assert.rejects(host.request('readWordFormat',{selection:partial.selection,fields:[],paragraphFields}),/WORD_FULL_PARAGRAPHS_REQUIRED/);
  report.checks.push('partial paragraph refused before writing');
  for(const [index,needle] of ['Native Word original','Native Word original\rKeep this paragraph unchanged'].entries()){
    const target=await native.resolveTarget(host.binding.documentId,{kind:'word',text:needle});assert.equal(target.status,'resolved');
    const payload={selection:target.selection,fields,paragraphFields};
    const before=await host.request('readWordFormat',payload);
    const edit={selection:target.selection,operationId:'paragraph_'+index,font:{bold:true,size:14},paragraph:{alignment:'center' as const,spaceBefore:6,spaceAfter:12,leftIndent:18,rightIndent:0,firstLineIndent:0,keepWithNext:true,keepTogether:true}};
    const operation=await formatWordSelection(broker,host.binding.documentId,edit);
    if(operation.status!=='applied'){report.unverifiedOperation=operation.id;throw Error('Paragraph edit failed verification: '+JSON.stringify(operation.result));}
    pending=operation.id;
    const after=await host.request('readWordFormat',payload);
    assert.equal(after.text,before.text);assert.equal(after.paragraphs.length,index+1);
    for(const p of after.paragraphs)assert.deepEqual(p.format,{alignment:1,spaceBefore:6,spaceAfter:12,leftIndent:18,rightIndent:0,firstLineIndent:0,keepWithNext:-1,keepTogether:-1});
    assert.equal((await formatWordSelection(broker,host.binding.documentId,{...edit,operationId:'stale_'+index})).status,'conflict');
    const reread=await broker.readText(host.binding.documentId,{count:10});
    assert.deepEqual(reread.items.map((item:any)=>item.text),text.items.map((item:any)=>item.text));
    if(index===0)assert.equal(reread.items[1].contentHash,text.items[1].contentHash,'Unselected neighbor formatting changed.');
    const restored=await restoreOperation(broker,pending);
    assert.equal(restored.status,'applied',JSON.stringify(restored.result));pending=undefined;
    const final=await host.request('readWordFormat',payload);
    assert.deepEqual(final.paragraphs.map((p:any)=>p.contentHash),before.paragraphs.map((p:any)=>p.contentHash));
    assert.equal(final.contentHash,before.contentHash);
    assert.equal(await fileHash(),originalFileHash);
    report.checks.push(index===0?'single paragraph combined formatting, neighbor preservation, stale refusal and XML recovery':'two-paragraph batch formatting, readback and exact XML recovery');
  }
  report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:'Paragraph verification failed.';process.exitCode=1;}
finally{
  if(pending){
    try{const restored=await restoreOperation(broker,pending);report.cleanupRestored=restored.status==='applied';if(!report.cleanupRestored)report.pendingOperation=pending;}
    catch{report.pendingOperation=pending;report.cleanupRestored=false;}
  }
  await native.stop();store.close();
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,evidence:directory}));
}
