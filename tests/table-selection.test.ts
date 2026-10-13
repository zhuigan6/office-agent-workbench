import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionSchema} from '../packages/contracts/selection.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {mutateSelectedTable} from '../packages/document-workspace/table-selection.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {frozenSelectionContext} from '../packages/contracts/selection-context.ts';
import type {Operation} from '../packages/contracts/index.ts';
import {targetSchema} from '../packages/contracts/target.ts';
const reference={tableIndex:1,tableStart:10,rows:3,columns:2,hostSessionId:'worker:window',revision:'a'.repeat(64)};
const selection={kind:'word' as const,documentId:'doc',hostSessionId:reference.hostSessionId,storyType:1,start:10,end:60,preview:'table',contentHash:reference.revision,table:reference};
test('whole-table capture is explicit, coherent and distinct from a cell',()=>{
  assert.deepEqual(selectionSchema.parse(selection),selection);
  for(const change of [{start:11},{contentHash:'b'.repeat(64)},{hostSessionId:'other'},{storyType:2},{cell:{tableIndex:1,row:1,column:1}}])assert.equal(selectionSchema.safeParse({...selection,...change}).success,false);
  assert.match(frozenSelectionContext('fixed',selection),/ONE complete ordinary table/);
  const guard=new SelectionGuard();guard.set('chat',{id:'fixed',kind:'word'});
  for(const route of ['/tools/table-batch','/tools/table-layout','/tools/table-rows']){
    assert.doesNotThrow(()=>guard.assert('chat',route,{selectionId:'fixed'}));
    assert.throws(()=>guard.assert('chat',route,{reference}),{code:'SELECTION_LOCKED'});
  }
});
test('explicit whole-table targeting never accepts a partial coordinate or text ambiguity',()=>{
  assert.deepEqual(targetSchema.parse({kind:'word',tableIndex:1}),{kind:'word',tableIndex:1});
  assert.equal(targetSchema.safeParse({kind:'word',tableIndex:1,row:2,column:2}).success,true);
  for(const input of [{tableIndex:1,row:2},{tableIndex:1,column:2},{tableIndex:1,text:'elsewhere'},{tableIndex:1,match:2}])assert.equal(targetSchema.safeParse({kind:'word',...input}).success,false);
});
test('table selection refuses partial/cell references or substituted tables before execution',async()=>{
  const tickets=new SelectionTickets(),store=new Store(':memory:'),broker=new DocumentBroker(store),scope={conversation:'chat',documentId:'doc'};let writes=0;
  const {table,...partial}=selection;
  try{
    const ticket=tickets.capture('chat',partial);
    await assert.rejects(mutateSelectedTable(tickets,broker,scope,{selectionId:ticket.id,operationId:'one'},async()=>{writes++;throw Error('unexpected');}),{code:'TABLE_SELECTION_REQUIRED'});
    const full=tickets.capture('chat',selection);
    await assert.rejects(mutateSelectedTable(tickets,broker,scope,{selectionId:full.id,operationId:'two',reference:{...reference,tableIndex:2}},async()=>{writes++;throw Error('unexpected');}),{code:'SELECTION_SCOPE'});
    assert.equal(writes,0);
  }finally{store.close();}
});
test('verified table edits advance only the fixed table, including appended rows',async()=>{
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',selection),store=new Store(':memory:'),broker=new DocumentBroker(store);let current=selection;
  broker.attach({binding:{documentId:'doc',kind:'word',hostSessionId:'worker',name:'fixture',capabilities:['writeText'],lastSeen:1},request:async(method,payload:any)=>{assert.equal(method,'readWordTableSelection');assert.deepEqual(payload.reference,current.table);return structuredClone(current);}});
  try{
    for(const [index,kind] of ['word.table.layout','word.table.batch','word.table.rows'].entries()){
      const operationId='op'+index,before=tickets.lookup(ticket.id,'chat','doc');assert.ok(before.kind==='word'&&before.table);
      const beforeTable=before.table;
      const result=await mutateSelectedTable(tickets,broker,{conversation:'chat',documentId:'doc'},{selectionId:ticket.id,operationId},async ref=>{
        assert.deepEqual(ref,beforeTable);const hash=String(index+1).repeat(64),rows=beforeTable.rows+(kind==='word.table.rows'?1:0);
        current={...current,contentHash:hash,end:current.end+5,table:{...beforeTable,rows,revision:hash}};
        return {id:operationId,documentId:'doc',kind,status:'applied',createdAt:1,updatedAt:1,payload:{reference:ref,...(kind==='word.table.rows'?{append:[['West','240']]}:{})},result:{verified:true,revision:hash,reference:current.table}};
      });
      assert.equal((result.selectionReference as any).status,'advanced');assert.equal(tickets.lookup(ticket.id,'chat','doc').contentHash,current.contentHash);
    }
    assert.equal(ticket.selection.contentHash,'a'.repeat(64));
  }finally{store.close();}
});
test('unknown, foreign or retargeted table results cannot advance the reference',()=>{
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',selection);tickets.forOperation(ticket.id,'chat','doc','one');
  const after={...selection,contentHash:'b'.repeat(64),table:{...reference,revision:'b'.repeat(64)}};
  const op:Operation={id:'one',documentId:'doc',kind:'word.table.layout',status:'applied',createdAt:1,updatedAt:1,payload:{reference},result:{verified:true,revision:after.contentHash,reference:after.table,continuationSelection:after}};
  for(const status of ['unknown','conflict','failed'] as const)assert.equal(tickets.complete(ticket.id,'chat','doc',{...op,status}).status,'not-advanced');
  for(const update of [{documentId:'foreign'},{table:{...after.table,tableIndex:2}},{table:{...after.table,rows:4}}])assert.equal(tickets.complete(ticket.id,'chat','doc',{...op,result:{...(op.result as any),continuationSelection:{...after,...update}}}).status,'not-advanced');
  assert.equal(tickets.lookup(ticket.id,'chat','doc').contentHash,selection.contentHash);
});
