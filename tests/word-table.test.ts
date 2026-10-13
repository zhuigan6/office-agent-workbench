import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {targetSchema} from '../packages/contracts/target.ts';
import {planLiveRequest} from '../packages/contracts/live-tools.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {replaceWordSelection} from '../packages/document-workspace/word-replace.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
test('table coordinates are explicit and cannot silently replace exact-text targets',()=>{
  assert.doesNotThrow(()=>targetSchema.parse({kind:'word',tableIndex:1,row:2,column:2}));
  for(const extra of [{row:0},{column:21},{tableIndex:0},{text:'other'},{match:2},{column:undefined}])assert.throws(()=>targetSchema.parse({kind:'word',tableIndex:1,row:2,column:2,...extra}));
  assert.equal((planLiveRequest({kind:'word',capabilities:['readText']},{action:'execute',operation:'tables',params:{count:2}}) as any).route,'/tools/tables');
  assert.throws(()=>planLiveRequest({kind:'excel',capabilities:['read']},{action:'help',operation:'tables'}),{code:'LIVE_OPERATION_UNAVAILABLE'});
});
test('Word cell restoration package excludes all table wrappers and preserves rich paragraph and style parts',{skip:process.platform!=='win32'},async()=>{
  const result=await promisify(execFile)(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',path.resolve('tests/word-table-package.ps1')],{windowsHide:true,timeout:20000});
  assert.match(result.stdout,/WORD_CELL_PACKAGE=PASS/);
});
test('table text recovery uses its guarded cell snapshot, never the cell paragraph table wrapper',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store),selection={kind:'word' as const,documentId:'doc',hostSessionId:'worker:window',storyType:1,start:65,end:68,preview:'120',contentHash:'a'.repeat(64)};
  const table={xml:'<whole-table/>',contentHash:'t1',row:2,column:2,cellStart:65,cellEnd:68},paragraph={xml:'<table-wrapped-paragraph/>',contentHash:'p1'};
  let current:any={text:'120',selection,contentHash:selection.contentHash,table,paragraph},writes=0;
  broker.attach({binding:{documentId:'doc',kind:'word',hostSessionId:'worker',name:'test',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readWordReplacement')return structuredClone(current);
    const before=structuredClone(current);writes++;
    if(writes===2){assert.deepEqual(payload.restoreTable,table);assert.equal(payload.expectedTableHash,'t2');assert.equal(payload.restoreParagraph,undefined);assert.equal(payload.splices,undefined);}
    current={...current,text:payload.text,contentHash:(writes===1?'b':'a').repeat(64),selection:{...selection,end:65+payload.text.length},table:{...table,contentHash:writes===1?'t2':'t1'}};
    return {verified:true,before,after:structuredClone(current),revision:current.contentHash};
  }});
  try{assert.equal((await replaceWordSelection(broker,'doc',{operationId:'cell',selection,text:'1250'})).status,'applied');assert.equal((await restoreOperation(broker,'cell')).status,'applied');assert.equal(current.text,'120');}finally{store.close();}
});
test('Word cell identity survives verified text-length changes but cannot switch task or range',()=>{
  const tickets=new SelectionTickets(),selection={kind:'word' as const,documentId:'doc',hostSessionId:'worker:window',storyType:1,start:65,end:68,preview:'120',contentHash:'a'.repeat(64),cell:{tableIndex:1,row:2,column:2}};
  const ticket=tickets.capture('chat',selection),before=tickets.forOperation(ticket.id,'chat','doc','edit');
  const operation:any={id:'edit',documentId:'doc',kind:'word.replace',status:'applied',createdAt:1,updatedAt:1,payload:{selection:before,text:'1250'},result:{verified:true,revision:'b'.repeat(64),after:{selection:{...before,end:69},text:'1250',contentHash:'b'.repeat(64)}}};
  assert.equal(tickets.complete(ticket.id,'chat','doc',operation).status,'advanced');
  const next=tickets.lookup(ticket.id,'chat','doc');assert.ok(next.kind==='word');assert.deepEqual(next.cell,selection.cell);assert.equal(next.start,65);assert.equal(next.end,69);
  assert.throws(()=>tickets.lookup(ticket.id,'other','doc'),{code:'SELECTION_SCOPE'});
});
