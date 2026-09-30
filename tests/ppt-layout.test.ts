import test from 'node:test';
import assert from 'node:assert/strict';
import {pptLayoutSchema} from '../packages/contracts/ppt-layout.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutPptSelection} from '../packages/document-workspace/ppt-layout.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
const selection={kind:'powerpoint',documentId:'ppt',hostSessionId:'s:1',slideId:'256',shapeIds:['2'],layoutRevision:'a'.repeat(64),contentHash:'b'.repeat(64),preview:''};
test('PPT layout requires one fixed shape and bounded explicit geometry',()=>{
  const input={operationId:'move',selection,geometry:{left:20}};assert.doesNotThrow(()=>pptLayoutSchema.parse(input));
  for(const geometry of [{},{width:0},{left:Infinity},{rotation:361},{delete:true}])assert.throws(()=>pptLayoutSchema.parse({...input,geometry}));
  assert.throws(()=>pptLayoutSchema.parse({...input,selection:{...selection,shapeIds:['1','2']}}));
  assert.throws(()=>pptLayoutSchema.parse({...input,selection:{...selection,layoutRevision:undefined}}));
});
test('PPT geometry revisions are independent of font revisions and restore exact snapshots',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let writes=0;
  let state={selection,contentHash:selection.layoutRevision,state:{geometry:{left:10,top:20,width:300,height:100,rotation:0}}};
  broker.attach({binding:{documentId:'ppt',kind:'powerpoint',hostSessionId:'s',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readPptLayout')return structuredClone(state);writes++;const before=structuredClone(state);
    state={...state,contentHash:(writes===1?'c':'a').repeat(64),state:{geometry:{...state.state.geometry,...payload.geometry}}};
    return {before,after:state,revision:state.contentHash,verified:true};
  }});
  try{
    const input={selection,operationId:'move',geometry:{left:42}};
    assert.equal((await layoutPptSelection(broker,'ppt',input)).status,'applied');
    assert.equal((await layoutPptSelection(broker,'ppt',input)).status,'applied');assert.equal(writes,1);
    assert.equal((await layoutPptSelection(broker,'ppt',{...input,operationId:'stale'})).status,'conflict');
    assert.equal((await restoreOperation(broker,'move')).status,'applied');assert.equal(state.state.geometry.left,10);
  }finally{store.close();}
});
