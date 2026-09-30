import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import type {Operation} from '../packages/contracts/index.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {revision} from '../packages/document-workspace/store.ts';
const original={kind:'word' as const,documentId:'word1',hostSessionId:'worker:window',storyType:1,start:0,end:3,preview:'old',contentHash:'a'.repeat(64)};
function edited(before:any,id:string,text:string,hash:string):Operation{
  const next={...before,end:before.start+text.length,preview:text,contentHash:hash};
  return {id,documentId:before.documentId,kind:'word.replace',status:'applied',createdAt:1,updatedAt:1,payload:{selection:before,text},result:{verified:true,revision:hash,after:{selection:next,text,contentHash:hash}}};
}
test('a verified chain advances only the version/end of the fixed Word reference; replay never regresses',()=>{
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',original),guard=new SelectionGuard();guard.set('chat',{id:ticket.id,kind:'word'});
  const first=tickets.forOperation(ticket.id,'chat','word1','replace');
  const op=edited(first,'replace','expanded','b'.repeat(64));
  assert.equal(tickets.complete(ticket.id,'chat','word1',op).status,'advanced');
  const next=tickets.forOperation(ticket.id,'chat','word1','next');
  assert.ok(next.kind==='word');
  assert.equal(next.end,8);assert.equal(next.contentHash,'b'.repeat(64));assert.equal(ticket.selection.contentHash,original.contentHash);
  const second=edited(next,'next','again','c'.repeat(64));assert.equal(tickets.complete(ticket.id,'chat','word1',second).status,'advanced');
  assert.deepEqual(tickets.forOperation(ticket.id,'chat','word1','replace'),first);
  assert.equal(tickets.complete(ticket.id,'chat','word1',op).status,'already-applied');
  assert.equal(tickets.lookup(ticket.id,'chat','word1').contentHash,'c'.repeat(64));
  assert.doesNotThrow(()=>guard.assert('chat','/tools/format-selection',{selectionId:ticket.id}));
  assert.throws(()=>guard.assert('chat','/tools/target',{text:'elsewhere'}),{code:'SELECTION_LOCKED'});
});
test('failed, uncertain, foreign, retargeted or competing results cannot advance references',()=>{
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',original);
  const before=tickets.forOperation(ticket.id,'chat','word1','one');
  tickets.forOperation(ticket.id,'chat','word1','competitor');
  const op=edited(before,'one','new','b'.repeat(64));
  for(const status of ['conflict','unknown','failed'] as const)assert.equal(tickets.complete(ticket.id,'chat','word1',{...op,status}).status,'not-advanced');
  assert.equal(tickets.complete(ticket.id,'chat','word1',{...op,documentId:'other'}).status,'not-advanced');
  const corrupt=structuredClone(op) as any;corrupt.result.after.selection.start=20;
  assert.equal(tickets.complete(ticket.id,'chat','word1',corrupt).status,'not-advanced');
  assert.equal(tickets.complete(ticket.id,'chat','word1',op).status,'advanced');
  assert.equal(tickets.complete(ticket.id,'chat','word1',edited(before,'competitor','oops','d'.repeat(64))).status,'not-advanced');
  assert.equal(tickets.lookup(ticket.id,'chat','word1').contentHash,'b'.repeat(64));
});
test('continuation cannot extend TTL, survive a worker restart, cross scope or consume unbounded entries',()=>{
  let now=0;const tickets=new SelectionTickets(()=>now,100),ticket=tickets.capture('chat',original);
  const before=tickets.forOperation(ticket.id,'chat','word1','one');
  assert.throws(()=>tickets.forOperation(ticket.id,'other','word1','two'),{code:'SELECTION_SCOPE'});
  assert.throws(()=>tickets.resolve(ticket.id,'chat','word1','new-worker'),{code:'SELECTION_SESSION_CHANGED'});
  for(let i=1;i<100;i++)tickets.forOperation(ticket.id,'chat','word1','op'+i);
  assert.throws(()=>tickets.forOperation(ticket.id,'chat','word1','overflow'),{code:'SELECTION_OPERATION_LIMIT'});
  now=100;assert.equal(tickets.complete(ticket.id,'chat','word1',edited(before,'one','new','b'.repeat(64))).status,'unavailable');
  assert.throws(()=>tickets.lookup(ticket.id,'chat','word1'),{code:'SELECTION_MISSING'});
});
test('PowerPoint font/layout continuations retain one shape and both distinct fingerprints',()=>{
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',{kind:'powerpoint',documentId:'ppt1',hostSessionId:'worker:window',slideId:'256',shapeIds:['2'],preview:'title',contentHash:'a'.repeat(64),layoutRevision:'b'.repeat(64)});
  const before=tickets.forOperation(ticket.id,'chat','ppt1','font');
  const font:Operation={id:'font',documentId:'ppt1',kind:'ppt.format',status:'applied',createdAt:1,updatedAt:1,payload:{selection:before},result:{verified:true,revision:'c'.repeat(64),after:{contentHash:'c'.repeat(64)}}};
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',font).status,'advanced');
  const current=tickets.forOperation(ticket.id,'chat','ppt1','layout');assert.ok(current.kind==='powerpoint');assert.equal(current.layoutRevision,'b'.repeat(64));
  const layout:Operation={id:'layout',documentId:'ppt1',kind:'ppt.layout',status:'applied',createdAt:1,updatedAt:1,payload:{selection:current,expectedTextFingerprint:'c'.repeat(64)},result:{verified:true,revision:'d'.repeat(64),beforeText:{contentHash:'c'.repeat(64)},afterText:{contentHash:'e'.repeat(64)},continuationSelection:{...current,layoutRevision:'d'.repeat(64),contentHash:'e'.repeat(64)}}};
  const retarget=structuredClone(layout) as any;retarget.result.continuationSelection.shapeIds=['3'];
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',retarget).status,'not-advanced');
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',layout).status,'advanced');
  const next=tickets.forOperation(ticket.id,'chat','ppt1','font2');assert.equal(next.contentHash,'e'.repeat(64));
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',font).status,'already-applied');assert.equal(tickets.lookup(ticket.id,'chat','ppt1').contentHash,'e'.repeat(64));
});
test('Excel continuation accepts only the same range and a verified state-derived revision',()=>{
  const state={sheetId:'Sheet1',sheetName:'Sheet1',address:'A1',values:[[1]],formulas:[[1]],numberFormat:[['General']]};
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',{kind:'excel',documentId:'xlsx1',hostSessionId:'worker',sheet:'Sheet1',range:'A1',expectedRevision:revision(state),contentHash:'a'.repeat(64),preview:'cell'});
  const before=tickets.forOperation(ticket.id,'chat','xlsx1','first');assert.ok(before.kind==='excel');
  const after={...state,values:[[2]],formulas:[[2]]};
  const op:Operation={id:'first',documentId:'xlsx1',kind:'excel.write',status:'applied',createdAt:1,updatedAt:1,payload:{sheet:'Sheet1',range:'A1',expectedRevision:before.expectedRevision},result:{verified:true,after,revision:revision(after)}};
  assert.equal(tickets.complete(ticket.id,'chat','xlsx1',{...op,result:{...(op.result as object),revision:'b'.repeat(64)}}).status,'not-advanced');
  assert.equal(tickets.complete(ticket.id,'chat','xlsx1',op).status,'advanced');
  const next=tickets.forOperation(ticket.id,'chat','xlsx1','second');assert.ok(next.kind==='excel');assert.equal(next.expectedRevision,revision(after));
  assert.deepEqual(tickets.forOperation(ticket.id,'chat','xlsx1','first'),before);
});
