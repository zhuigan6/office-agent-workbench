import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {appendWordTableRows,wordTableRowsSchema} from '../packages/document-workspace/word-table-rows.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {planLiveRequest} from '../packages/contracts/live-tools.ts';
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),rows=[['Region','Sales'],['North','120'],['South','180']];let writes=0,fail=false,manual='';
  const reference=()=>({tableIndex:1,tableStart:10,rows:rows.length,columns:2,hostSessionId:'word:1',revision:digest([rows,manual])});
  const read=()=>({reference:reference(),contentHash:digest(rows),xml:JSON.stringify(rows),documentText:JSON.stringify(rows)});
  broker.attach({binding:{documentId:'doc',kind:'word',name:'table',hostSessionId:'word',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(p.reference.revision!==reference().revision)throw Error('WORD_TABLE_REVISION_CONFLICT');if(method==='readWordTableLayout')return read();
    const before=read();writes++;if(p.restore)rows.splice(p.restore.reference.rows);else rows.push(...p.append);
    if(fail)throw Error('Lost after dispatch');const after=read();return {verified:true,before,after,revision:after.reference.revision,atomic:false};
  }});return {store,broker,rows,reference,get writes(){return writes;},set fail(v:boolean){fail=v;},set manual(v:string){manual=v;}};
}
test('row append deduplicates, rejects stale dimensions and restores only the appended rows',async()=>{
  const f=fixture();try{
    const input={operationId:'append',reference:f.reference(),append:[['West','240'],['East','320']]},op=await appendWordTableRows(f.broker,'doc',input);assert.equal(op.status,'applied');assert.equal(f.rows.length,5);
    await appendWordTableRows(f.broker,'doc',input);assert.equal(f.writes,1);assert.equal((await appendWordTableRows(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal(f.writes,1);
    assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.equal(f.rows.length,3);assert.deepEqual(f.rows[2],['South','180']);await restoreOperation(f.broker,op.id);assert.equal(f.writes,2);
  }finally{f.store.close();}
});
test('new changes prevent row deletion; an unknown append is not replayed or auto-restored',async()=>{
  const f=fixture();try{
    const input={operationId:'append',reference:f.reference(),append:[['West','240']]},op=await appendWordTableRows(f.broker,'doc',input);f.manual='edited';assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.rows.length,4);
    f.fail=true;const unknown={...input,operationId:'unknown',reference:f.reference()};assert.equal((await appendWordTableRows(f.broker,'doc',unknown)).status,'unknown');await appendWordTableRows(f.broker,'doc',unknown);assert.equal(f.writes,2);await assert.rejects(restoreOperation(f.broker,'unknown'),{code:'RECOVERY_UNAVAILABLE'});
  }finally{f.store.close();}
});
test('row shape/size/control limits and selection locks fail before structural writes',()=>{
  const f=fixture();try{
    const input={operationId:'one',reference:f.reference(),append:[['West','240']]};assert.doesNotThrow(()=>wordTableRowsSchema.parse(input));
    for(const append of [[],[['one']],[['x','two','three']],[['bad\n','text']],[['x'.repeat(2001),'ok']]])assert.throws(()=>wordTableRowsSchema.parse({...input,append}));
    assert.throws(()=>wordTableRowsSchema.parse({...input,reference:{...input.reference,rows:20}}));
    const plan:any=planLiveRequest({kind:'word',capabilities:['writeText']},{action:'execute',operation:'table-rows',params:input});assert.equal(plan.route,'/tools/table-rows');const guard=new SelectionGuard();guard.set('chat',{id:'cell',kind:'word'});assert.throws(()=>guard.assert('chat',plan.route,input),{code:'SELECTION_LOCKED'});
  }finally{f.store.close();}
});
