import test from 'node:test';
import assert from 'node:assert/strict';
import {planTextSplices,wordReplaceSchema} from '../packages/contracts/word-replace.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {replaceWordSelection} from '../packages/document-workspace/word-replace.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
test('Word splice plan preserves equal spans and uses descending immutable offsets',()=>{
  for(const [before,after] of [['Hello bold world','Hello bold planet'],['abc','XabcY'],['a😀bc','a🙂bc'],['AAAA','ABA'],['ab cd ef','AB cd EF'],['abc',''],['','xyz'],['same','same']]){
    let result=before;const edits=planTextSplices(before,after);
    for(let i=0;i<edits.length;i++){const edit=edits[i];if(i)assert.ok(edit.end<=edits[i-1].start);result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);}
    assert.equal(result,after);
  }
  assert.deepEqual(planTextSplices('keep middle keep','KEEP middle KEEP'),[{start:12,end:16,text:'KEEP'},{start:0,end:4,text:'KEEP'}]);
  assert.deepEqual(planTextSplices('a😀b','a🙂b'),[{start:1,end:3,text:'🙂'}]);
});
test('Word replacement refuses structural text, out-of-bound ranges and excess work',()=>{
  const input={operationId:'replace',selection:{kind:'word',documentId:'doc',hostSessionId:'s:1',contentHash:'a'.repeat(64),preview:'text',storyType:1,start:0,end:4},text:'new'};
  assert.doesNotThrow(()=>wordReplaceSchema.parse(input));
  for(const text of ['line\nbreak','tab\t','cell\u0007'])assert.throws(()=>wordReplaceSchema.parse({...input,text}));
  assert.doesNotThrow(()=>wordReplaceSchema.parse({...input,selection:{...input.selection,end:0}}));
  assert.throws(()=>wordReplaceSchema.parse({...input,text:'',selection:{...input.selection,end:0}}));
  assert.doesNotThrow(()=>wordReplaceSchema.parse({...input,selection:{...input.selection,end:0,cell:{tableIndex:1,row:1,column:1}}}));
  assert.throws(()=>wordReplaceSchema.parse({...input,text:'',selection:{...input.selection,end:0,cell:{tableIndex:1,row:1,column:1}}}));
  assert.throws(()=>planTextSplices('a'.repeat(2001),'b'));
});
test('Word replacement retains paragraph restoration context, deduplicates and refuses stale targets',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);
  const selection={kind:'word' as const,documentId:'doc',hostSessionId:'s:1',contentHash:'a'.repeat(64),preview:'abc',storyType:1,start:0,end:3};
  let state={selection,text:'abc',xml:'<partial/>',documentText:'abc tail\r',contentHash:selection.contentHash,paragraph:{start:0,end:9,xml:'<whole/>',contentHash:'p'}},writes=0;
  broker.attach({binding:{documentId:'doc',kind:'word',hostSessionId:'s',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readWordReplacement')return structuredClone(state);
    const before=structuredClone(state);writes++;
    if(payload.restoreParagraph){assert.equal(payload.restoreParagraph.xml,'<whole/>');assert.equal(payload.expectedParagraphHash,'changed');}
    else assert.deepEqual(payload.splices,planTextSplices('abc','abcd'));
    state={...state,text:payload.text,contentHash:(writes===1?'b':'a').repeat(64),selection:{...selection,end:payload.text.length},paragraph:{...state.paragraph,contentHash:writes===1?'changed':'p'}};
    return {verified:true,before,after:structuredClone(state),revision:state.contentHash};
  }});
  try{
    const input={operationId:'replace1',selection,text:'abcd'};
    assert.equal((await replaceWordSelection(broker,'doc',input)).status,'applied');
    assert.equal((await replaceWordSelection(broker,'doc',input)).status,'applied');assert.equal(writes,1);
    assert.equal((await replaceWordSelection(broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal(writes,1);
    assert.equal((await restoreOperation(broker,'replace1')).status,'applied');assert.equal(writes,2);
    assert.equal(state.text,'abc');
    await assert.rejects(replaceWordSelection(broker,'other',input),{code:'SELECTION_SCOPE'});
  }finally{store.close();}
});
