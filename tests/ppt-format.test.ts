import test from 'node:test';
import assert from 'node:assert/strict';
import {pptFormatSchema} from '../packages/contracts/ppt-format.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {formatPptSelection} from '../packages/document-workspace/ppt-format.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
const selection={kind:'powerpoint',documentId:'ppt',hostSessionId:'s:1',slideId:'256',shapeIds:['2'],textStart:2,textLength:1,contentHash:'a'.repeat(64),preview:'b'};
test('rich restoration only allows a null/empty unused alias, never a different font/size/theme',{skip:process.platform!=='win32'},()=>{
  const script=fileURLToPath(new URL('../scripts/Verify-PptAliasRestore.ps1',import.meta.url));const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PPT_ALIAS_RESTORE_BOUNDARY=PASS/);
});
test('PowerPoint font contracts require one bounded nonempty text target',()=>{
  const input={selection,operationId:'p1',font:{bold:true}};
  assert.doesNotThrow(()=>pptFormatSchema.parse(input));
  for(const change of [{shapeIds:['1','2']},{textLength:0},{textStart:0}])assert.throws(()=>pptFormatSchema.parse({...input,selection:{...selection,...change}}));
  assert.throws(()=>pptFormatSchema.parse({...input,font:{size:401}}));
  assert.throws(()=>pptFormatSchema.parse({...input,font:{name:'Arial'}}));
  const captured={...selection,replacementRevision:'c'.repeat(64)};assert.doesNotThrow(()=>pptFormatSchema.parse({...input,selection:captured,font:{name:'Arial',color:'#0E7490',bold:true,size:20}}));
  for(const font of [{color:'red'},{color:'#FFF'},{name:'bad\nname'},{name:' Arial'},{size:0}])assert.throws(()=>pptFormatSchema.parse({...input,selection:captured,font}));
});
test('rich font and color use the captured rich revision and retain full profiles for restoration',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);const captured={...selection,replacementRevision:'c'.repeat(64)};let calls=0;
  const profile={Name:'Theme font',Color:{type:2,theme:5,tint:0.25}};
  let state={selection:captured,contentHash:captured.replacementRevision,formatHash:captured.contentHash,state:{start:2,length:1,text:'abc',profiles:[profile,profile,profile]}};
  broker.attach({binding:{documentId:'ppt',kind:'powerpoint',hostSessionId:'s',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(method==='readPptReplacement')return structuredClone(state);assert.equal(method,'writePptRichFormat');calls++;
    const before=structuredClone(state);if(p.restoreProfiles){assert.deepEqual(p.restoreProfiles,[profile]);assert.equal(p.expectedFingerprint,'d'.repeat(64));}
    state={...state,contentHash:(calls===1?'d':'c').repeat(64),formatHash:(calls===1?'b':'a').repeat(64)};
    return {before,after:{...state,contentHash:state.formatHash},verified:true,revision:state.formatHash,replacementRevision:state.contentHash};
  }});
  try{
    const tickets=new SelectionTickets(),ticket=tickets.capture('chat',captured),selected=tickets.forOperation(ticket.id,'chat','ppt','rich');
    const op=await formatPptSelection(broker,'ppt',{selection:selected,operationId:'rich',font:{name:'Arial',color:'#0E7490'}});assert.equal(op.status,'applied');assert.equal((op.payload as any).expectedFingerprint,captured.replacementRevision);assert.equal(tickets.complete(ticket.id,'chat','ppt',op).status,'advanced');
    const next=tickets.lookup(ticket.id,'chat','ppt');assert.equal(next.contentHash,'b'.repeat(64));assert.equal(next.kind==='powerpoint'&&next.replacementRevision,'d'.repeat(64));assert.equal((await restoreOperation(broker,'rich')).status,'applied');assert.equal(calls,2);
  }finally{store.close();}
});
test('PPT formatting records exact subrange restoration, deduplicates and blocks stale revisions',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let writes=0;
  let state={selection,contentHash:selection.contentHash,state:{start:2,length:1,text:'abc',fonts:[{bold:0},{bold:0},{bold:-1}]}};
  broker.attach({binding:{documentId:'ppt',kind:'powerpoint',hostSessionId:'s',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readPptFormat')return structuredClone(state);
    const before=structuredClone(state);writes++;
    if(payload.restore){assert.deepEqual(payload.restore,[{bold:0}]);assert.deepEqual(payload.fields,['bold']);}
    state={...state,contentHash:(writes===1?'b':'a').repeat(64),state:{...state.state,fonts:[{bold:0},{bold:payload.restore?0:-1},{bold:-1}]}};
    return {verified:true,before,after:state,revision:state.contentHash};
  }});
  try{
    const input={selection,operationId:'p1',font:{bold:true}};
    assert.equal((await formatPptSelection(broker,'ppt',input)).status,'applied');
    assert.equal((await formatPptSelection(broker,'ppt',input)).status,'applied');assert.equal(writes,1);
    assert.equal((await formatPptSelection(broker,'ppt',{...input,operationId:'stale'})).status,'conflict');
    assert.equal((await restoreOperation(broker,'p1')).status,'applied');assert.equal(writes,2);
    await assert.rejects(formatPptSelection(broker,'other',input),{code:'SELECTION_SCOPE'});
  }finally{store.close();}
});
test('versioned frame formatting uses rich execution and recovers intrinsic profiles and layout revision',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store),captured={...selection,frameProfileVersion:1 as const,layoutRevision:'b'.repeat(64),replacementRevision:'c'.repeat(64)};let changed=false,writes=0;
  assert.doesNotThrow(()=>pptFormatSchema.parse({operationId:'missing',selection:{...captured,replacementRevision:undefined},font:{bold:true}}));
  const snapshot=()=>({selection:captured,contentHash:(changed?'d':'c').repeat(64),formatHash:(changed?'e':'a').repeat(64),state:{text:'abc',start:2,length:1,profiles:[{Size:5},{Size:5},{Size:5}]}});
  broker.attach({binding:{documentId:'ppt',kind:'powerpoint',hostSessionId:'s',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(method==='readPptReplacement')return snapshot();assert.equal(method,'writePptRichFormat');writes++;const before=snapshot();if(changed){assert.deepEqual(p.restoreProfiles,[{Size:18}]);assert.equal(p.selection.layoutRevision,'f'.repeat(64));changed=false;}else changed=true;
    const after=snapshot(),continuationSelection={...captured,contentHash:after.formatHash,replacementRevision:after.contentHash,layoutRevision:(changed?'f':'b').repeat(64)};
    return {verified:true,before,beforeNominal:{state:{...before.state,profiles:[{Size:18},{Size:18},{Size:18}]}},after:{...after,contentHash:after.formatHash},revision:after.formatHash,replacementRevision:after.contentHash,layoutRevision:continuationSelection.layoutRevision,continuationSelection};
  }});
  try{const tickets=new SelectionTickets(),ticket=tickets.capture('fit',captured),op=await formatPptSelection(broker,'ppt',{operationId:'fit',selection:tickets.forOperation(ticket.id,'fit','ppt','fit'),font:{bold:true}});assert.equal(op.status,'applied');assert.equal(tickets.complete(ticket.id,'fit','ppt',op).status,'advanced');const next=tickets.lookup(ticket.id,'fit','ppt');assert.ok(next.kind==='powerpoint');assert.equal(next.layoutRevision,'f'.repeat(64));assert.equal((await restoreOperation(broker,op.id)).status,'applied');assert.equal(writes,2);}finally{store.close();}
});
