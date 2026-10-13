import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {replaceWordParagraphBatch,wordParagraphBatchSchema} from '../packages/document-workspace/word-paragraph-batch.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),text=['one','two','three'];let writes=0,fail:'none'|'known'|'unknown'='none',foreign='';
  const hash=()=>digest([text,foreign]),documentHash=()=>digest(text.join('\r')+'\rneighbor'+foreign),paragraphHash=(i:number)=>digest(text[i]);
  const child=(i:number)=>{const start=text.slice(0,i).reduce((n,t)=>n+t.length+1,0);return {kind:'word' as const,documentId:'doc',hostSessionId:'word:1',storyType:1,start,end:start+text[i].length,preview:text[i],contentHash:hash()};};
  const selection=()=>({...child(0),end:text.join('\r').length,preview:text.join('\r')});
  const read=()=>({selection:selection(),contentHash:hash(),documentHash:documentHash(),items:text.map((t,i)=>({text:t,selection:child(i),paragraphHash:paragraphHash(i)}))});
  const single=(i:number)=>({selection:child(i),text:text[i],contentHash:hash(),documentHash:documentHash(),paragraph:{xml:'paragraph',contentHash:paragraphHash(i)}});
  broker.attach({binding:{documentId:'doc',kind:'word',hostSessionId:'word',name:'body',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(method==='readWordParagraphBatch')return read();
    const i=text.findIndex((_,i)=>child(i).start===p.selection.start);if(i<0)throw Error('Invalid paragraph offset');if(method==='readWordReplacement')return single(i);
    const before=single(i);writes++;if(writes===2&&fail==='known')return {notIssued:true,verified:false,code:'READ_ONLY'};
    text[i]=p.text;if(writes===2&&fail==='unknown')throw Error('Lost after dispatch');const after=single(i);return {before,after,verified:true,revision:after.contentHash};
  }});
  return {store,broker,text,selection,get writes(){return writes;},set fail(v:typeof fail){fail=v;},set foreign(v:string){foreign=v;}};
}
test('paragraph batch keeps count, tracks moved offsets and advances the frozen reference',async()=>{
  const f=fixture();try{
    const tickets=new SelectionTickets(),ticket=tickets.capture('chat',f.selection()),input={operationId:'batch',selection:tickets.forOperation(ticket.id,'chat','doc','batch'),paragraphs:['long first','short','new last']};
    const op=await replaceWordParagraphBatch(f.broker,'doc',input);assert.equal(op.status,'applied');assert.deepEqual(f.text,input.paragraphs);assert.equal(f.writes,3);assert.equal(tickets.complete(ticket.id,'chat','doc',op).status,'advanced');
    assert.equal((await replaceWordParagraphBatch(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,3);assert.equal((await replaceWordParagraphBatch(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');
    assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.deepEqual(f.text,['one','two','three']);assert.equal(f.writes,6);
  }finally{f.store.close();}
});
test('paragraph preflight rejects count mismatch, and known partial steps restore while unknown cannot replay',async()=>{
  for(const fault of ['known','unknown'] as const){const f=fixture();try{
    const input={operationId:'batch',selection:f.selection(),paragraphs:['new first','new second','new third']};
    assert.equal((await replaceWordParagraphBatch(f.broker,'doc',{...input,operationId:'count',paragraphs:['only one']})).status,'failed');assert.equal(f.writes,0);
    f.fail=fault;const op=await replaceWordParagraphBatch(f.broker,'doc',input);assert.equal(op.status,fault==='known'?'failed':'unknown');assert.equal((op.result as any).restoreAvailable,fault==='known');await replaceWordParagraphBatch(f.broker,'doc',input);assert.equal(f.writes,2);
    if(fault==='known'){f.fail='none';assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.deepEqual(f.text,['one','two','three']);}else await assert.rejects(restoreOperation(f.broker,op.id),{code:'RECOVERY_UNAVAILABLE'});
  }finally{f.store.close();}}
});
test('paragraph batch restoration refuses new user changes; scope never expands a different selection',async()=>{
  const f=fixture();try{
    const input={operationId:'batch',selection:f.selection(),paragraphs:['new one','new two','new three']};const op=await replaceWordParagraphBatch(f.broker,'doc',input);f.foreign='user';assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.writes,3);
    for(const change of [{paragraphs:['']},{paragraphs:['line\nbreak']},{selection:{...input.selection,cell:{tableIndex:1,row:1,column:1}}},{selection:{...input.selection,end:0}}])assert.throws(()=>wordParagraphBatchSchema.parse({...input,...change}));
    const guard=new SelectionGuard();guard.set('chat',{id:'fixed',kind:'word'});assert.doesNotThrow(()=>guard.assert('chat','/tools/paragraph-batch',{selectionId:'fixed'}));assert.throws(()=>guard.assert('chat','/tools/paragraph-batch',{selectionId:'other'}),{code:'SELECTION_LOCKED'});
  }finally{f.store.close();}
});
test('post-write batch verification failure fences recovery, rather than adopting a new current snapshot',async()=>{
  const f=fixture();try{
    const host=f.broker.host('doc');let reads=0;
    f.broker.attach({binding:host.binding,request:async(method,p:any)=>{if(method==='readWordParagraphBatch'&&++reads===3)throw Error('Lost batch readback');return host.request(method,p);}});
    const input={operationId:'lost-read',selection:f.selection(),paragraphs:['new one','new two','new three']};
    const op=await replaceWordParagraphBatch(f.broker,'doc',input);assert.equal(op.status,'unknown');assert.equal(f.writes,1);assert.equal((op.result as any).restoreAvailable,false);
    await replaceWordParagraphBatch(f.broker,'doc',input);assert.equal(f.writes,1);await assert.rejects(restoreOperation(f.broker,op.id),{code:'RECOVERY_UNAVAILABLE'});
  }finally{f.store.close();}
});
test('missing paragraph child journals cannot produce a fully recovered batch',async()=>{
  const f=fixture();try{
    const op=await replaceWordParagraphBatch(f.broker,'doc',{operationId:'missing',selection:f.selection(),paragraphs:['new one','new two','new three']});assert.equal(op.status,'applied');
    const id=(op.result as any).children[0].id;f.store.db.prepare('DELETE FROM operations WHERE id=?').run(id);
    assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.writes,3);
  }finally{f.store.close();}
});
