import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionSchema} from '../packages/contracts/selection.ts';
import {SelectionTickets,captureBoundSelection,writeExcelSelection} from '../packages/document-workspace/selections.ts';
import {Store,revision} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
const selection={kind:'excel',documentId:'doc1',hostSessionId:'session1',sheet:'Sheet1',range:'B2:C3',expectedRevision:'b'.repeat(64),contentHash:'a'.repeat(64),preview:'example'};
test('stored conversation doc maps to capture scope without relying on UI aliases',async()=>{
  const store=new Store(':memory:');
  try{store.linkConversation('chat','native:excel:one',{});const link=store.conversations()[0];
    assert.equal(link.documentId,undefined);
    const ticket=await captureBoundSelection({id:link.id,documentId:link.doc},async documentId=>({...selection,documentId}),new SelectionTickets());
    assert.equal(ticket.selection.documentId,'native:excel:one');
  }finally{store.close();}
});
test('frozen Excel target uses captured version, refuses drift and retains ordinary recovery',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store),tickets=new SelectionTickets();
  let state={sheetId:'Sheet1',sheetName:'Sheet1',address:'A1',values:[[1]],formulas:[[1]],numberFormat:[['General']]};
  let writes=0;
  broker.attach({binding:{documentId:'doc1',hostSessionId:'session1',name:'test',kind:'excel',capabilities:['read','write'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='read')return structuredClone(state);
    assert.equal(payload.range,'A1');writes++;const before=structuredClone(state);
    state={...state,values:payload.values??payload.formulas,formulas:payload.formulas??payload.values,numberFormat:payload.numberFormat??state.numberFormat};
    return {verified:true,before,after:structuredClone(state),revision:revision(state)};
  }});
  try{
    const ticket=tickets.capture('chat',{...selection,range:'A1',expectedRevision:revision(state)});
    const scope={conversation:'chat',documentId:'doc1'};
    const input={selectionId:ticket.id,operationId:'selected',values:[[2]]};
    let checks=0;const verify=async()=>{checks++;};
    tickets.capture('chat',{...selection,range:'Z1',expectedRevision:revision(state)});
    assert.equal((await writeExcelSelection(tickets,broker,scope,input,verify)).status,'applied');
    assert.equal((await writeExcelSelection(tickets,broker,scope,input,verify)).status,'applied');
    assert.equal(writes,1);assert.equal(checks,1);
    assert.equal((await writeExcelSelection(tickets,broker,scope,{...input,operationId:'stale',values:[[3]]},verify)).status,'conflict');
    assert.equal(writes,1);
    assert.equal((await restoreOperation(broker,'selected')).status,'applied');assert.deepEqual(state.values,[[1]]);
    const failed=await writeExcelSelection(tickets,broker,scope,{...input,operationId:'closed'},async()=>{throw Error('window closed');});
    assert.equal(failed.status,'failed');assert.equal(writes,2);
    await assert.rejects(writeExcelSelection(tickets,broker,{...scope,conversation:'other'},input,verify),{code:'SELECTION_SCOPE'});
  }finally{store.close();}
});
test('selection capture derives document from task and rejects mismatched native replies',async()=>{
  const tickets=new SelectionTickets(),link={id:'chat',documentId:'native:excel:one'};
  let calls=0;
  const capture=async(id:string)=>{calls++;assert.equal(id,link.documentId);return {...selection,documentId:id};};
  await assert.rejects(captureBoundSelection({...link,documentId:'file1'},capture,tickets),{code:'SELECTION_NATIVE_REQUIRED'});
  assert.equal(calls,0);
  const result=await captureBoundSelection(link,capture,tickets);
  assert.equal(result.conversation,'chat');assert.equal(result.selection.documentId,link.documentId);
  await assert.rejects(captureBoundSelection(link,async()=>selection,tickets),{code:'SELECTION_SCOPE'});
});
test('selection ticket freezes target even when later capture and caller objects change',()=>{
  const tickets=new SelectionTickets(),input={...selection},first=tickets.capture('chat',input);
  input.range='D1';first.selection.preview='mutated';tickets.capture('chat',{...selection,range:'D1'});
  const resolved=tickets.resolve(first.id,'chat','doc1','session1');assert.equal(resolved.kind==='excel'&&resolved.range,'B2:C3');assert.equal(resolved.preview,'example');
  resolved.preview='also mutated';assert.equal(tickets.resolve(first.id,'chat','doc1','session1').preview,'example');
});
test('selection tickets refuse other tasks/documents, restarted host, expiry and overflow',()=>{
  let now=1;const tickets=new SelectionTickets(()=>now,10,1),ticket=tickets.capture('chat',selection);
  assert.throws(()=>tickets.resolve(ticket.id,'other','doc1','session1'),{code:'SELECTION_SCOPE'});
  assert.throws(()=>tickets.resolve(ticket.id,'chat','doc2','session1'),{code:'SELECTION_SCOPE'});
  assert.throws(()=>tickets.resolve(ticket.id,'chat','doc1','session2'),{code:'SELECTION_SESSION_CHANGED'});
  assert.throws(()=>tickets.capture('chat',selection),{code:'SELECTION_LIMIT'});
  assert.throws(()=>tickets.release(ticket.id,'other'),{code:'SELECTION_SCOPE'});
  now=11;assert.throws(()=>tickets.resolve(ticket.id,'chat','doc1','session1'),{code:'SELECTION_EXPIRED'});tickets.capture('chat',selection);
});
test('selection schemas reject unbounded ranges and ambiguous native text anchors',()=>{
  assert.throws(()=>selectionSchema.parse({...selection,range:'A:A'}));
  const {sheet,range,expectedRevision,...base}=selection;
  assert.throws(()=>selectionSchema.parse({...base,kind:'word',storyType:1,start:10,end:2}));
  assert.doesNotThrow(()=>selectionSchema.parse({...base,kind:'word',storyType:1,start:10,end:10}));
  assert.throws(()=>selectionSchema.parse({...base,kind:'powerpoint',slideId:'1',shapeIds:['2','3'],textStart:1,textLength:3}));
});
test('slide selections retain ordered frozen IDs and reject ambiguous or excessive targets',()=>{
  const base={kind:'powerpoint-slides',documentId:'ppt',hostSessionId:'window1',contentHash:'b'.repeat(64),preview:'slides',slideIds:['256','258']};
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',base);
  base.slideIds.reverse();
  const captured=tickets.resolve(ticket.id,'chat','ppt','window1');
  assert.equal(captured.kind,'powerpoint-slides');
  if(captured.kind==='powerpoint-slides')assert.deepEqual(captured.slideIds,['256','258']);
  assert.throws(()=>selectionSchema.parse({...base,slideIds:[]}));
  assert.throws(()=>selectionSchema.parse({...base,slideIds:['256','256']}));
  assert.throws(()=>selectionSchema.parse({...base,slideIds:Array.from({length:51},(_,i)=>String(i))}));
  assert.throws(()=>selectionSchema.parse({...base,shapeIds:['1']}));
});
