import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutPptBatch,pptLayoutBatchSchema} from '../packages/document-workspace/ppt-layout-batch.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
test('batch receipt reports actual object appearance without rich snapshots or dormant metadata',()=>{
  const child:any={id:'child',kind:'ppt.layout',status:'applied',payload:{selection:{shapeIds:['2']}},result:{verified:true,after:{state:{geometry:{left:80,top:300,width:260,height:90},profiles:['private-only'],appearance:{fill:{visible:-1,color:{rgb:11919090,theme:0,tint:0},transparency:0.15},outline:{visible:0}}}}}};
  const receipt=writeToolResult({kind:'ppt.layout.batch',status:'applied',payload:{},result:{verified:true,restoreAvailable:true,children:[child]}} as any);
  assert.deepEqual(JSON.parse(JSON.stringify(receipt.steps?.[0])),{operationId:'child',shapeId:'2',status:'applied',verified:true,geometry:{left:80,top:300,width:260,height:90},appearance:{fill:{mode:'solid',color:'#F2DEB5',transparency:0.15},outline:{mode:'none'}}});
  assert.ok(!JSON.stringify(receipt).includes('private-only'));assert.ok(!JSON.stringify(receipt).includes('theme'));
});
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),states=new Map(['2','3'].map(shapeId=>[shapeId,{geometry:{left:10,top:20,width:100,height:40,rotation:0},appearance:{fill:{visible:0},outline:{visible:0}}}]));
  let writes=0,refuse='';
  const snapshot=(id:string,selection:any)=>({selection,state:structuredClone(states.get(id)),contentHash:digest(states.get(id))});
  broker.attach({binding:{kind:'powerpoint',documentId:'ppt',hostSessionId:'session',name:'fixture',capabilities:['writeText'],lastSeen:1},request:async(method,p:any)=>{
    const id=p.selection.shapeIds[0],before=snapshot(id,p.selection);if(method==='readPptLayout')return before;
    assert.equal(p.selection.appearanceProfileVersion,1);assert.equal(p.selection.frameProfileVersion,1);
    if(id===refuse)return {notIssued:true,verified:false,code:'READ_ONLY'};
    writes++;const old=states.get(id)!;states.set(id,{geometry:{...old.geometry,...p.geometry},appearance:p.restoreAppearance??p.appearance??old.appearance});
    const after=snapshot(id,p.selection);return {before,after,verified:true,revision:after.contentHash};
  }});
  const selection={kind:'powerpoint' as const,documentId:'ppt',hostSessionId:'session:window',slideId:'256',shapeIds:['2','3'],contentHash:digest('multi'),preview:'',shapeLayouts:['2','3'].map(shapeId=>({shapeId,layoutRevision:digest(states.get(shapeId)),contentHash:digest(states.get(shapeId)),frameProfileVersion:1 as const,appearanceProfileVersion:1 as const}))};
  const input={selection,operationId:'batch',edits:[{shapeId:'2',geometry:{left:40},appearance:{fill:{mode:'solid',color:'#204030'}}},{shapeId:'3',appearance:{outline:{mode:'none'}}}]};
  return {store,broker,states,input,writes:()=>writes,refuse:(id:string)=>{refuse=id;}};
}
test('multi-appearance preserves per-object scope, compact continuation and inverse recovery',async()=>{
  const f=fixture();try{
    const before=structuredClone([...f.states]),tickets=new SelectionTickets(),ticket=tickets.capture('task',f.input.selection);
    const op=await layoutPptBatch(f.broker,'ppt',{...f.input,selection:tickets.forOperation(ticket.id,'task','ppt','batch')});assert.equal(op.status,'applied');assert.equal(f.writes(),2);
    assert.equal(tickets.complete(ticket.id,'task','ppt',op).status,'advanced');
    const continued:any=tickets.lookup(ticket.id,'task','ppt');assert.ok(continued.shapeLayouts.every((s:any)=>s.appearanceProfileVersion===1&&s.frameProfileVersion===1));
    assert.equal((await layoutPptBatch(f.broker,'ppt',f.input)).id,op.id);assert.equal(f.writes(),2);
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.deepEqual([...f.states],before);
  }finally{f.store.close();}
});
test('missing appearance proof on ANY requested object refuses before the first write',async()=>{
  const f=fixture();try{
    const old={...f.input.selection,shapeLayouts:f.input.selection.shapeLayouts.map((s,i)=>({...s,...(i===1?{appearanceProfileVersion:undefined}:{})}))};
    assert.throws(()=>pptLayoutBatchSchema.parse({...f.input,selection:old}));assert.equal(f.writes(),0);
    for(const edits of [[{shapeId:'2'}],[{shapeId:'2',textFrame:{autoFit:'shape'}}],[{shapeId:'other',appearance:{fill:{mode:'none'}}}]])assert.throws(()=>pptLayoutBatchSchema.parse({...f.input,edits}));
  }finally{f.store.close();}
});
test('appearance batch preflights all objects and records/restores only known applied steps',async()=>{
  const f=fixture();try{
    f.states.get('3')!.geometry.top=90;assert.equal((await layoutPptBatch(f.broker,'ppt',{...f.input,operationId:'stale'})).status,'conflict');assert.equal(f.writes(),0);
    f.states.get('3')!.geometry.top=20;f.refuse('3');const op=await layoutPptBatch(f.broker,'ppt',f.input);assert.equal(op.status,'failed');assert.equal((op.result as any).children.length,2);assert.equal((op.result as any).restoreAvailable,true);assert.equal(f.writes(),1);
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.equal(f.states.get('2')!.geometry.left,10);assert.deepEqual(f.states.get('2')!.appearance,{fill:{visible:0},outline:{visible:0}});
  }finally{f.store.close();}
});
