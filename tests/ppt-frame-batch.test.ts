import test from 'node:test';
import assert from 'node:assert/strict';
import {pptLayoutBatchSchema,layoutPptBatch} from '../packages/document-workspace/ppt-layout-batch.ts';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),states=new Map(['2','3'].map(id=>[id,{geometry:{left:10,top:20,width:300,height:160},textFrame:{AutoSize:0},profiles:[{Size:18}],paragraphs:[{Alignment:1}],text:'frame '+id}]));
  let writes=0,richChanged='';const hash=(id:string)=>digest(states.get(id)),rich=(id:string)=>digest([states.get(id),richChanged===id?'manual change':'']);
  broker.attach({binding:{kind:'powerpoint',documentId:'ppt',hostSessionId:'session',name:'fixture',capabilities:['writeText'],lastSeen:1},request:async(method,p:any)=>{
    const id=p.selection.shapeIds[0],state=states.get(id)!;
    if(method==='readPptLayout')return {selection:p.selection,contentHash:hash(id),state:structuredClone(state)};
    if(method==='readPptReplacement')return {contentHash:rich(id),state:structuredClone(state)};
    writes++;assert.equal(p.expectedRichFingerprint,rich(id));const before={selection:p.selection,contentHash:hash(id),state:structuredClone(state)},beforeRich={contentHash:rich(id),state:structuredClone(state)};
    state.geometry={...state.geometry,...p.geometry};state.textFrame=p.restoreTextFrame??{AutoSize:p.textFrame.autoFit==='shape'?1:p.textFrame.autoFit==='text'?2:0};
    return {before,beforeRich,after:{state:structuredClone(state)},afterRich:{contentHash:rich(id)},revision:hash(id),verified:true,continuationSelection:{...p.selection,layoutRevision:hash(id),contentHash:hash(id),replacementRevision:rich(id)}};
  }});
  const selection={kind:'powerpoint' as const,documentId:'ppt',hostSessionId:'session:window',slideId:'256',shapeIds:['2','3'],preview:'',contentHash:digest('multi'),shapeLayouts:['2','3'].map(shapeId=>({shapeId,layoutRevision:hash(shapeId),contentHash:hash(shapeId),frameProfileVersion:1 as const,paragraphProfileVersion:1 as const,replacementRevision:rich(shapeId)}))};
  const input={operationId:'batch',selection,edits:[{shapeId:'2',geometry:{width:240},textFrame:{autoFit:'shape'}},{shapeId:'3',textFrame:{autoFit:'text'}}]};return {store,broker,states,input,writes:()=>writes,changeRich:(id:string)=>{richChanged=id;}};
}
test('batch frames require each rich capture and preserve hashes through continuation/recovery',async()=>{
  const f=fixture();try{
    assert.doesNotThrow(()=>pptLayoutBatchSchema.parse(f.input));const before=structuredClone([...f.states]),tickets=new SelectionTickets(),ticket=tickets.capture('task',f.input.selection);
    const op=await layoutPptBatch(f.broker,'ppt',{...f.input,selection:tickets.forOperation(ticket.id,'task','ppt','batch')});assert.equal(op.status,'applied');assert.equal(tickets.complete(ticket.id,'task','ppt',op).status,'advanced');const ref:any=tickets.lookup(ticket.id,'task','ppt');assert.ok(ref.shapeLayouts.every((s:any)=>s.replacementRevision!==f.input.selection.shapeLayouts.find(x=>x.shapeId===s.shapeId)?.replacementRevision));
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.deepEqual([...f.states],before);
    assert.throws(()=>pptLayoutBatchSchema.parse({...f.input,selection:{...f.input.selection,shapeLayouts:f.input.selection.shapeLayouts.map((s,i)=>({...s,...(i===1?{replacementRevision:undefined}:{})}))}}));
  }finally{f.store.close();}
});
test('stale rich text in the later target refuses the whole batch before its first write',async()=>{
  const f=fixture();try{f.changeRich('3');assert.equal((await layoutPptBatch(f.broker,'ppt',f.input)).status,'conflict');assert.equal(f.writes(),0);}finally{f.store.close();}
});
test('geometry resize of an existing fitted capture reuses frame writer and restores original mode',async()=>{
  const f=fixture();try{
    f.states.get('2')!.textFrame.AutoSize=2;const ref=f.input.selection.shapeLayouts[0];ref.layoutRevision=digest(f.states.get('2'));ref.contentHash=ref.layoutRevision;ref.replacementRevision=digest([f.states.get('2'),'']);
    const op=await layoutPptBatch(f.broker,'ppt',{...f.input,edits:[{shapeId:'2',geometry:{width:220}}]});assert.equal(op.status,'applied');assert.equal((op.result as any).children[0].result.frameGeometry,true);assert.equal(f.states.get('2')!.textFrame.AutoSize,2);assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.equal(f.states.get('2')!.geometry.width,300);assert.equal(f.states.get('2')!.textFrame.AutoSize,2);
  }finally{f.store.close();}
});
