import test from 'node:test';
import assert from 'node:assert/strict';
import {planPptTextEdit,pptReplaceSchema} from '../packages/contracts/ppt-replace.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {replacePptSelection} from '../packages/document-workspace/ppt-replace.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';

const selection={kind:'powerpoint' as const,documentId:'ppt1',hostSessionId:'worker:window',slideId:'256',shapeIds:['2'],textStart:3,textLength:3,preview:'abc',contentHash:'b'.repeat(64),replacementRevision:'a'.repeat(64),layoutRevision:'c'.repeat(64)};
test('PPT replacement retains equal text profiles and untouched prefix/suffix',()=>{
  const state={text:'XXabcYY',start:3,length:3,profiles:Array.from({length:7},(_,i)=>({font:i}))};
  const plan=planPptTextEdit(state,'aBCc');
  assert.equal(plan.expectedText,'XXaBCcYY');
  assert.deepEqual(plan.expectedProfiles,[{font:0},{font:1},{font:2},{font:3},{font:3},{font:4},{font:5},{font:6}]);
  assert.deepEqual(plan.expectedProfileOrigins,[0,1,2,3,3,4,5,6]);
  let result=state.text;
  for(const edit of plan.splices)result=result.slice(0,2+edit.start)+edit.text+result.slice(2+edit.end);
  assert.equal(result,plan.expectedText);
  assert.deepEqual(planPptTextEdit(state,'abc').splices,[]);
  const unicode=planPptTextEdit({text:'a😀b',start:2,length:2,profiles:[0,1,1,2]},'🙂!');
  assert.equal(unicode.expectedText,'a🙂!b');
  assert.deepEqual(unicode.expectedProfiles,[0,1,1,1,2]);
  assert.deepEqual(unicode.expectedProfileOrigins,[0,1,1,1,3]);
});
test('PPT replacement rejects structural edits, stale-capability references and half-surrogates',()=>{
  const input={operationId:'replace',selection,text:'new'};
  assert.doesNotThrow(()=>pptReplaceSchema.parse(input));
  for(const text of ['','a\nb','a\tb','x'.repeat(2001)])assert.throws(()=>pptReplaceSchema.parse({...input,text}));
  assert.throws(()=>pptReplaceSchema.parse({...input,selection:{...selection,replacementRevision:undefined}}));
  assert.throws(()=>pptReplaceSchema.parse({...input,selection:{...selection,shapeIds:['2','3']}}));
  for(const state of [
    {text:'a😀b',start:3,length:1,profiles:[0,1,1,2]},
    {text:'a😀b',start:2,length:1,profiles:[0,1,1,2]},
    {text:'abc',start:0,length:1,profiles:[0,1,2]},
    {text:'abc',start:1,length:3,profiles:[]},
    {text:'a\rb',start:1,length:3,profiles:[0,1,2]},
    {text:'x'.repeat(2000),start:1,length:1,profiles:Array(2000).fill(0)},
  ])assert.throws(()=>planPptTextEdit(state,'new'));
});
test('PPT journal deduplicates, checks rich revision and restores mixed-profile text',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);
  let state={text:'XXabcYY',start:3,length:3,profiles:Array.from({length:7},(_,i)=>({font:i}))},hash=selection.replacementRevision,writes=0,uncertain=false;
  const snapshot=()=>({state:structuredClone(state),selection,contentHash:hash,formatHash:selection.contentHash});
  broker.attach({binding:{documentId:'ppt1',kind:'powerpoint',hostSessionId:'worker',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readPptReplacement')return snapshot();
    const before=snapshot();writes++;
    if(uncertain)throw Error('Connection lost after dispatch');
    state={text:payload.expectedText,start:3,length:payload.text.length,profiles:payload.expectedProfiles};hash=(writes===1?'d':'a').repeat(64);
    const next={...payload.selection,contentHash:selection.contentHash,replacementRevision:hash,textLength:payload.text.length,preview:payload.text};
    return {verified:true,before,after:snapshot(),revision:hash,continuationSelection:next};
  }});
  try{
    const input={operationId:'replace',selection,text:'aBCc'},first=await replacePptSelection(broker,'ppt1',input);
    assert.equal(first.status,'applied');assert.equal(state.text,'XXaBCcYY');
    assert.equal((await replacePptSelection(broker,'ppt1',input)).status,'applied');assert.equal(writes,1);
    assert.equal((await replacePptSelection(broker,'ppt1',{...input,operationId:'stale'})).status,'conflict');assert.equal(writes,1);
    assert.equal((await restoreOperation(broker,'replace')).status,'applied');assert.equal(state.text,'XXabcYY');
    assert.deepEqual(state.profiles,Array.from({length:7},(_,i)=>({font:i})));
    assert.equal((await restoreOperation(broker,'replace')).status,'applied');assert.equal(writes,2);
    await assert.rejects(replacePptSelection(broker,'other',input),{code:'SELECTION_SCOPE'});
    uncertain=true;
    assert.equal((await replacePptSelection(broker,'ppt1',{...input,operationId:'unknown'})).status,'unknown');
    assert.equal((await replacePptSelection(broker,'ppt1',{...input,operationId:'unknown'})).status,'unknown');assert.equal(writes,3);
  }finally{store.close();}
});
test('PPT text continuation freezes identity, updates length and chains format without stale replacement revisions',()=>{
  const tickets=new SelectionTickets(),ticket=tickets.capture('chat',selection),guard=new SelectionGuard();guard.set('chat',{id:ticket.id,kind:'powerpoint'});
  assert.doesNotThrow(()=>guard.assert('chat','/tools/replace-selection',{selectionId:ticket.id}));
  assert.throws(()=>guard.assert('chat','/tools/replace-selection',{selectionId:'other'}),{code:'SELECTION_LOCKED'});
  const before=tickets.forOperation(ticket.id,'chat','ppt1','replace'),next={...selection,textLength:4,preview:'abcd',replacementRevision:'d'.repeat(64)};
  const op:any={id:'replace',documentId:'ppt1',kind:'ppt.replace',status:'applied',createdAt:1,updatedAt:1,payload:{selection:before,text:'abcd'},result:{verified:true,revision:next.replacementRevision,after:{formatHash:next.contentHash},continuationSelection:next}};
  const moved=structuredClone(op);moved.result.continuationSelection.shapeIds=['3'];
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',moved).status,'not-advanced');
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',op).status,'advanced');
  const fontBefore=tickets.forOperation(ticket.id,'chat','ppt1','font');assert.ok(fontBefore.kind==='powerpoint');assert.equal(fontBefore.textLength,4);
  const format:any={id:'font',documentId:'ppt1',kind:'ppt.format',status:'applied',createdAt:1,updatedAt:1,payload:{selection:fontBefore},result:{verified:true,revision:'e'.repeat(64),replacementRevision:'f'.repeat(64),after:{contentHash:'e'.repeat(64)}}};
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',format).status,'advanced');
  const fresh=tickets.forOperation(ticket.id,'chat','ppt1','font2');assert.ok(fresh.kind==='powerpoint');assert.equal(fresh.replacementRevision,'f'.repeat(64));
  format.id='font2';format.payload.selection=fresh;format.result.replacementRevision=null;
  assert.equal(tickets.complete(ticket.id,'chat','ppt1',format).status,'advanced');
  assert.ok(tickets.lookup(ticket.id,'chat','ppt1').kind==='powerpoint');
  assert.equal((tickets.lookup(ticket.id,'chat','ppt1') as typeof selection).replacementRevision,undefined);
});
test('fitted text continuation updates only verified layout revision without dropping profile guards',()=>{
  const tickets=new SelectionTickets(),ref={...selection,frameProfileVersion:1 as const,paragraphProfileVersion:1 as const},ticket=tickets.capture('fit',ref),before=tickets.forOperation(ticket.id,'fit','ppt1','replace');
  const next={...ref,textLength:4,preview:'abcd',replacementRevision:'d'.repeat(64),layoutRevision:'e'.repeat(64)};
  const op:any={id:'replace',documentId:'ppt1',kind:'ppt.replace',status:'applied',createdAt:1,updatedAt:1,payload:{selection:before,text:'abcd'},result:{verified:true,revision:next.replacementRevision,layoutRevision:next.layoutRevision,after:{formatHash:next.contentHash},continuationSelection:next}};
  for(const patch of [{layoutRevision:'f'.repeat(64)},{frameProfileVersion:undefined},{paragraphProfileVersion:undefined}]){const bad=structuredClone(op);Object.assign(bad.result.continuationSelection,patch);assert.equal(tickets.complete(ticket.id,'fit','ppt1',bad).status,'not-advanced');}
  assert.equal(tickets.complete(ticket.id,'fit','ppt1',op).status,'advanced');assert.equal((tickets.lookup(ticket.id,'fit','ppt1') as typeof next).layoutRevision,next.layoutRevision);
});
test('fitted replacement recovery passes captured intrinsic profiles, not shrunk getter sizes',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store),ref={...selection,frameProfileVersion:1 as const};let changed=false;
  const snapshot=()=>({selection:ref,contentHash:changed?'d'.repeat(64):ref.replacementRevision,formatHash:ref.contentHash,state:{text:changed?'XXxyzYY':'XXabcYY',start:3,length:3,profiles:Array.from({length:7},()=>({Size:5}))}});
  broker.attach({binding:{documentId:'ppt1',kind:'powerpoint',hostSessionId:'worker',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(method==='readPptReplacement')return snapshot();const before=snapshot();if(changed){assert.ok(p.restoreNominalProfiles.every((v:any)=>v.Size===18));assert.ok(p.expectedProfiles.every((v:any)=>v.Size===5));changed=false;}else changed=true;
    const after=snapshot();return {verified:true,before,beforeNominal:{state:{...before.state,profiles:Array.from({length:7},()=>({Size:18}))}},after,revision:after.contentHash,continuationSelection:{...ref,replacementRevision:after.contentHash}};
  }});
  try{const op=await replacePptSelection(broker,'ppt1',{operationId:'fit-replace',selection:ref,text:'xyz'});assert.equal(op.status,'applied');assert.equal((await restoreOperation(broker,op.id)).status,'applied');assert.equal(changed,false);}finally{store.close();}
});
