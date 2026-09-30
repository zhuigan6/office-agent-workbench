import test from 'node:test';
import assert from 'node:assert/strict';
import {pptFormatSchema} from '../packages/contracts/ppt-format.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {formatPptSelection} from '../packages/document-workspace/ppt-format.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
const selection={kind:'powerpoint',documentId:'ppt',hostSessionId:'s:1',slideId:'256',shapeIds:['2'],textStart:2,textLength:1,contentHash:'a'.repeat(64),preview:'b'};
test('PowerPoint font contracts require one bounded nonempty text target',()=>{
  const input={selection,operationId:'p1',font:{bold:true}};
  assert.doesNotThrow(()=>pptFormatSchema.parse(input));
  for(const change of [{shapeIds:['1','2']},{textLength:0},{textStart:0}])assert.throws(()=>pptFormatSchema.parse({...input,selection:{...selection,...change}}));
  assert.throws(()=>pptFormatSchema.parse({...input,font:{size:401}}));
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
