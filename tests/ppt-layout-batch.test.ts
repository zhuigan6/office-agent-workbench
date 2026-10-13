import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutPptBatch,pptLayoutBatchSchema} from '../packages/document-workspace/ppt-layout-batch.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';

function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),states=new Map(['2','3'].map(shapeId=>[shapeId,{left:10,top:20,width:100,height:40,rotation:0}]));
  let writes=0,refuse='',unknown='';
  const snapshot=(shapeId:string,selection:any)=>({selection,state:{shapeId,geometry:structuredClone(states.get(shapeId))},contentHash:digest(states.get(shapeId))});
  broker.attach({binding:{kind:'powerpoint',documentId:'ppt',hostSessionId:'session',name:'fixture',capabilities:['writeText'],lastSeen:1},request:async(method,payload:any)=>{
    const id=payload.selection.shapeIds[0],before=snapshot(id,payload.selection);
    if(method==='readPptLayout')return before;
    if(refuse===id)return {notIssued:true,verified:false,code:'READ_ONLY'};
    writes++;states.set(id,{...states.get(id)!,...payload.geometry});
    if(unknown===id)throw Error('Lost acknowledgement');
    const after=snapshot(id,payload.selection);return {before,after,verified:true,revision:after.contentHash};
  }});
  const selection={kind:'powerpoint' as const,documentId:'ppt',hostSessionId:'session:window',slideId:'256',shapeIds:['2','3'],contentHash:digest('multi'),preview:'',shapeLayouts:['2','3'].map(shapeId=>({shapeId,layoutRevision:digest(states.get(shapeId)),contentHash:digest(states.get(shapeId))}))};
  const input={selection,operationId:'batch',edits:[{shapeId:'2',geometry:{left:40}},{shapeId:'3',geometry:{top:80}}]};
  return {store,broker,states,input,writes:()=>writes,refuse:(id:string)=>{refuse=id;},unknown:(id:string)=>{unknown=id;}};
}
test('multi-layout validates the frozen set, then reuses guarded writes, replay and reverse recovery',async()=>{
  const f=fixture();try{
    for(const edits of [[{shapeId:'other',geometry:{left:2}}],[f.input.edits[0],f.input.edits[0]],[{shapeId:'2',geometry:{width:0}}]])assert.throws(()=>pptLayoutBatchSchema.parse({...f.input,edits}));
    const before=structuredClone([...f.states.entries()]),tickets=new SelectionTickets(),ticket=tickets.capture('chat',f.input.selection);
    const op=await layoutPptBatch(f.broker,'ppt',{...f.input,selection:tickets.forOperation(ticket.id,'chat','ppt','batch')});
    assert.equal(op.status,'applied');assert.equal(f.writes(),2);assert.equal((op.result as any).atomic,false);
    assert.equal(tickets.complete(ticket.id,'chat','ppt',op).status,'advanced');
    assert.deepEqual((tickets.lookup(ticket.id,'chat','ppt') as any).shapeIds,['2','3']);
    assert.equal((await layoutPptBatch(f.broker,'ppt',f.input)).id,op.id);assert.equal(f.writes(),2);
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.deepEqual([...f.states.entries()],before);
  }finally{f.store.close();}
});
test('any stale preflight refuses the whole batch before its first write',async()=>{
  const f=fixture();try{f.states.get('3')!.left=90;assert.equal((await layoutPptBatch(f.broker,'ppt',f.input)).status,'conflict');assert.equal(f.writes(),0);}finally{f.store.close();}
});
test('partial known failure stops, journals applied steps, and can restore only those steps',async()=>{
  const f=fixture();try{
    f.refuse('3');const result=await layoutPptBatch(f.broker,'ppt',f.input);
    assert.equal(result.status,'failed');assert.equal((result.result as any).restoreAvailable,true);assert.equal(f.writes(),1);
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.equal(f.states.get('2')!.left,10);assert.equal(f.states.get('3')!.top,20);
  }finally{f.store.close();}
});
test('unknown results are not replayed or labelled a completed batch recovery',async()=>{
  const f=fixture();try{
    f.unknown('3');const result=await layoutPptBatch(f.broker,'ppt',f.input);
    assert.equal(result.status,'unknown');assert.equal((result.result as any).restoreAvailable,false);
    await assert.rejects(restoreOperation(f.broker,'batch'),{code:'RECOVERY_UNAVAILABLE'});
    await layoutPptBatch(f.broker,'ppt',f.input);assert.equal(f.writes(),2);
  }finally{f.store.close();}
});
test('batch recovery checks every changed shape before restoring the first',async()=>{
  const f=fixture();try{
    await layoutPptBatch(f.broker,'ppt',f.input);f.states.get('2')!.top=77;
    assert.equal((await restoreOperation(f.broker,'batch')).status,'conflict');assert.equal(f.writes(),2);assert.equal(f.states.get('3')!.top,80);
  }finally{f.store.close();}
});
