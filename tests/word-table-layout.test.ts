import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutWordTable,wordTableLayoutSchema} from '../packages/document-workspace/word-table-layout.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {planLiveRequest} from '../packages/contracts/live-tools.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),state={alignment:'left',topPadding:0,leftPadding:5.4},breaks=[true,false,true];let writes=0,fail=false,manual='';
  const reference=()=>({tableIndex:1,tableStart:10,rows:3,columns:2,hostSessionId:'word:1',revision:digest([state,breaks,manual])});
  const read=()=>({reference:reference(),properties:structuredClone(state),rowBreaks:[...breaks],untouchedHash:'contents',documentText:'same',contentHash:digest([state,breaks])});
  broker.attach({binding:{documentId:'doc',kind:'word',name:'table',hostSessionId:'word',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(p.reference.revision!==reference().revision)throw Error('WORD_TABLE_REVISION_CONFLICT');
    const before=read();if(method==='readWordTableLayout')return before;
    writes++;if(fail)throw Error('Transport lost');
    if(p.restore){for(const field of p.fields){if(field==='allowBreakAcrossPages')breaks.splice(0,breaks.length,...p.restore.rowBreaks);else (state as any)[field]=p.restore.properties[field];}}
    else {for(const [key,value] of Object.entries(p.properties)){if(key==='allowBreakAcrossPages')breaks.fill(value as boolean);else (state as any)[key]=value;}}
    const after=read();return {before,after,verified:true,revision:after.reference.revision};
  }});
  return {store,broker,state,breaks,reference,get writes(){return writes;},set fail(v:boolean){fail=v;},set manual(v:string){manual=v;}};
}
test('table layout combines properties, deduplicates and restores mixed per-row break states',async()=>{
  const f=fixture();try{
    const input={operationId:'layout',reference:f.reference(),properties:{alignment:'center',topPadding:6,allowBreakAcrossPages:false}};
    const op=await layoutWordTable(f.broker,'doc',input);assert.equal(op.status,'applied');assert.equal(f.state.alignment,'center');assert.deepEqual(f.breaks,[false,false,false]);
    assert.equal((await layoutWordTable(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,1);
    assert.equal((await layoutWordTable(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal(f.writes,1);
    assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.equal(f.state.alignment,'left');assert.equal(f.state.topPadding,0);assert.deepEqual(f.breaks,[true,false,true]);
    assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.equal(f.writes,2);
  }finally{f.store.close();}
});
test('layout restoration refuses later changes and unknown results never permit replay',async()=>{
  const f=fixture();try{
    const op=await layoutWordTable(f.broker,'doc',{operationId:'one',reference:f.reference(),properties:{leftPadding:8}});f.manual='user edit';
    assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.writes,1);
    f.fail=true;const request={operationId:'lost',reference:f.reference(),properties:{topPadding:2}};
    assert.equal((await layoutWordTable(f.broker,'doc',request)).status,'unknown');await layoutWordTable(f.broker,'doc',request);assert.equal(f.writes,2);
    await assert.rejects(restoreOperation(f.broker,'lost'),{code:'RECOVERY_UNAVAILABLE'});
  }finally{f.store.close();}
});
test('layout scope and parameters do not expand a selected-message edit',()=>{
  const f=fixture();try{
    const reference=f.reference();for(const properties of [{},{alignment:'justify'},{topPadding:-1},{rightPadding:73},{leftPadding:0.01},{allowBreakAcrossPages:1},{style:'new'},{shell:'anything'}])assert.throws(()=>wordTableLayoutSchema.parse({operationId:'bad',reference,properties}));
    const plan:any=planLiveRequest({kind:'word',capabilities:['writeText']},{action:'execute',operation:'table-layout',params:{operationId:'one',reference,properties:{alignment:'center'}}});assert.equal(plan.route,'/tools/table-layout');
    const guard=new SelectionGuard();guard.set('chat',{id:'single-cell',kind:'word'});assert.throws(()=>guard.assert('chat',plan.route,plan.params),{code:'SELECTION_LOCKED'});
    assert.throws(()=>planLiveRequest({kind:'word',capabilities:['readText']},{action:'execute',operation:'table-layout',params:{}}),{code:'LIVE_OPERATION_UNAVAILABLE'});
  }finally{f.store.close();}
});
test('native XML proof normalizes supported row/table declarations, not seven unrelated changes',{skip:process.platform!=='win32'},()=>{
  const script=fileURLToPath(new URL('../scripts/Verify-WordTableLayoutXml.ps1',import.meta.url));
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{normalization:true,unrelatedChangesRejected:7});
});
