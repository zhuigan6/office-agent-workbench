import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {formatWordSelection} from '../packages/document-workspace/word-format.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {wordFormatSchema} from '../packages/contracts/word-format.ts';
const selection={kind:'word' as const,documentId:'word1',hostSessionId:'worker:window',storyType:1,start:0,end:2,preview:'ab',contentHash:'a'.repeat(64)};
test('Word font contracts reject ambiguous scopes and invalid formatting',()=>{
  const input={selection,operationId:'format1',font:{bold:true}};
  assert.doesNotThrow(()=>wordFormatSchema.parse(input));
  for(const font of [{},{size:0},{size:12.25},{color:'red'},{bold:1}])assert.throws(()=>wordFormatSchema.parse({...input,font}));
  for(const changes of [{end:0},{end:2001},{storyType:2}])assert.throws(()=>wordFormatSchema.parse({...input,selection:{...selection,...changes}}));
});
test('Word paragraph properties compose with fonts without accepting arbitrary COM properties',()=>{
  const input={selection,operationId:'paragraph',paragraph:{alignment:'center',spaceBefore:6,spaceAfter:8,leftIndent:12,firstLineIndent:-6,keepWithNext:true,keepTogether:false}};
  assert.doesNotThrow(()=>wordFormatSchema.parse(input));
  assert.doesNotThrow(()=>wordFormatSchema.parse({...input,font:{bold:true,size:14}}));
  assert.doesNotThrow(()=>wordFormatSchema.parse({...input,paragraph:{style:'heading1',alignment:'center'},font:{size:18}}));
  assert.throws(()=>wordFormatSchema.parse({selection,operationId:'empty'}));
  for(const paragraph of [{},{alignment:'distributed'},{spaceAfter:-1},{firstLineIndent:-1585},{spaceBefore:Infinity},{keepWithNext:1},{style:'Heading 1'},{COM:'Save'}])
    assert.throws(()=>wordFormatSchema.parse({...input,paragraph}));
});
test('Word paragraph recovery preserves per-paragraph differences and refuses stale restoration',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);
  const original=[{start:0,end:1,format:{alignment:0,spaceAfter:3}},{start:1,end:2,format:{alignment:2,spaceAfter:9}}];
  let state:any={selection,fields:[],paragraphFields:['alignment','spaceAfter'],formats:[],paragraphs:original,text:'ab',contentHash:selection.contentHash},writes=0;
  broker.attach({binding:{documentId:'word1',hostSessionId:'worker',kind:'word',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readWordFormat')return structuredClone(state);
    writes++;const before=structuredClone(state);
    state={...state,contentHash:(writes===1?'b':'c').repeat(64),paragraphs:payload.restoreParagraphFormats??original.map(p=>({...p,format:{alignment:1,spaceAfter:12}}))};
    return {before,after:structuredClone(state),verified:true,revision:state.contentHash};
  }});
  try{
    const input={selection,operationId:'paragraph',paragraph:{alignment:'center',spaceAfter:12}};
    assert.equal((await formatWordSelection(broker,'word1',input)).status,'applied');
    assert.equal((await formatWordSelection(broker,'word1',input)).status,'applied');assert.equal(writes,1);
    const edited=structuredClone(state);state.contentHash='d'.repeat(64);
    assert.equal((await restoreOperation(broker,'paragraph')).status,'conflict');assert.equal(writes,1);
    // A conflicting restore receipt cannot be retried; use a distinct verified edit.
    state=edited;
    const second={...input,operationId:'paragraph2',selection:{...selection,contentHash:state.contentHash}};
    assert.equal((await formatWordSelection(broker,'word1',second)).status,'applied');
    assert.equal((await restoreOperation(broker,'paragraph2')).status,'applied');
    assert.deepEqual(state.paragraphs,edited.paragraphs);
  }finally{store.close();}
});
test('Word format journal freezes target, deduplicates, detects drift and restores mixed formats',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);
  let state={selection,fields:['bold'],text:'ab',contentHash:selection.contentHash,formats:[{bold:0},{bold:-1}]},writes=0;
  broker.attach({binding:{documentId:'word1',hostSessionId:'worker',kind:'word',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readWordFormat')return structuredClone(state);
    writes++;const before=structuredClone(state);
    state={...state,contentHash:(writes===1?'b':'c').repeat(64),formats:payload.restore??[{bold:-1},{bold:-1}]};
    return {before,after:structuredClone(state),verified:true,revision:state.contentHash};
  }});
  try{
    const input={selection,operationId:'format1',font:{bold:true}};
    assert.equal((await formatWordSelection(broker,'word1',input)).status,'applied');
    assert.equal((await formatWordSelection(broker,'word1',input)).status,'applied');assert.equal(writes,1);
    assert.equal((await formatWordSelection(broker,'word1',{...input,operationId:'stale'})).status,'conflict');assert.equal(writes,1);
    assert.equal((await restoreOperation(broker,'format1')).status,'applied');assert.deepEqual(state.formats,[{bold:0},{bold:-1}]);
    assert.equal((await restoreOperation(broker,'format1')).status,'applied');assert.equal(writes,2);
    await assert.rejects(formatWordSelection(broker,'other',input),{code:'SELECTION_SCOPE'});
  }finally{store.close();}
});
