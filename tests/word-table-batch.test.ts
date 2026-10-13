import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {editWordTableBatch,wordTableBatchSchema} from '../packages/document-workspace/word-table-batch.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {formatWordSelection} from '../packages/document-workspace/word-format.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),state={text:['120','180'],bold:[false,false]};
  const paragraphs=[{alignment:0,spaceAfter:0},{alignment:0,spaceAfter:0}];
  let writes=0,fail:'none'|'known'|'unknown'='none',gate:(()=>Promise<void>)|undefined,foreignReadAt=-1;
  const revision=()=>digest([state,paragraphs]),reference=()=>({tableIndex:1,tableStart:0,rows:3,columns:2,hostSessionId:'w:1',revision:revision()});
  const selection=(row:number)=>{const index=row-2,start=index===0?10:20+state.text[0].length;return {kind:'word' as const,documentId:'doc',hostSessionId:'w:1',storyType:1,start,end:start+state.text[index].length,preview:state.text[index],contentHash:digest([state,paragraphs,row]),cell:{tableIndex:1,row,column:2}};};
  const snapshot=(s:any,fields=['bold'],paragraphFields:string[]=[])=>{const i=s.cell.row-2;return {selection:s,text:state.text[i],contentHash:digest([state,paragraphs,s.cell.row]),paragraph:{xml:'paragraph',contentHash:'paragraph'},formats:Array(state.text[i].length).fill({bold:state.bold[i]?-1:0}),fields,paragraphFields,paragraphs:paragraphFields.length?[{format:structuredClone(paragraphs[i])}]:[],table:{row:s.cell.row,column:2,revision:revision(),contentHash:revision(),xml:'snapshot',saved:structuredClone(state),savedParagraphs:structuredClone(paragraphs)}};};
  broker.attach({binding:{documentId:'doc',kind:'word',hostSessionId:'w',name:'table',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(method==='readWordBatchCell'){if(p.reference.revision!==revision())throw Error('WORD_TABLE_REVISION_CONFLICT');const s=selection(p.row);return {selection:s,snapshot:snapshot(s)};}
    if(method==='readWordReplacement'||method==='readWordFormat'){if(p.fields?.includes('italic'))foreignReadAt=writes;return snapshot(p.selection,p.fields,p.paragraphFields);}
    const i=p.selection.cell.row-2,before=snapshot(p.selection,p.fields,p.paragraphFields);writes++;
    if(gate)await gate();
    if(writes===2&&fail==='known')return {notIssued:true,verified:false,code:'READ_ONLY'};
    if(p.restoreTable){state.text[i]=p.restoreTable.saved.text[i];state.bold[i]=p.restoreTable.saved.bold[i];Object.assign(paragraphs[i],p.restoreTable.savedParagraphs[i]);}
    else if(method==='writeWordReplacement')state.text[i]=p.text;
    else {if(p.font?.bold!==undefined)state.bold[i]=p.font.bold;if(p.paragraph){if(p.paragraph.alignment)paragraphs[i].alignment={left:0,center:1,right:2,justify:3}[p.paragraph.alignment as 'left'];if(p.paragraph.spaceAfter!==undefined)paragraphs[i].spaceAfter=p.paragraph.spaceAfter;}}
    if(writes===2&&fail==='unknown')throw Error('Disconnected after write');
    const after=snapshot(selection(p.selection.cell.row),p.fields,p.paragraphFields);return {verified:true,before,after,revision:after.contentHash};
  }});
  return {broker,store,state,paragraphs,reference,selection,get writes(){return writes;},get foreignReadAt(){return foreignReadAt;},set fail(v:typeof fail){fail=v;},set gate(v:typeof gate){gate=v;}};
}
test('table batch deduplicates, follows moved cell offsets, composes fonts and restores in reverse',async()=>{
  const f=fixture();try{
    const input={operationId:'batch',reference:f.reference(),edits:[{row:2,column:2,text:'12500',font:{bold:true}},{row:3,column:2,text:'200'}]};
    const op=await editWordTableBatch(f.broker,'doc',input);assert.equal(op.status,'applied');assert.deepEqual(f.state,{text:['12500','200'],bold:[true,false]});assert.equal(f.writes,3);
    assert.equal((await editWordTableBatch(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,3);
    assert.equal((await editWordTableBatch(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal(f.writes,3);
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.deepEqual(f.state,{text:['120','180'],bold:[false,false]});assert.equal(f.writes,6);
    assert.equal((await restoreOperation(f.broker,'batch')).status,'applied');assert.equal(f.writes,6);
  }finally{f.store.close();}
});
test('known partial failure restores verified steps; unknown side effects fence recovery and retry',async()=>{
  for(const fault of ['known','unknown'] as const){const f=fixture();try{
    f.fail=fault;const input={operationId:'partial',reference:f.reference(),edits:[{row:2,column:2,text:'12500'},{row:3,column:2,text:'200'}]};
    const op=await editWordTableBatch(f.broker,'doc',input);assert.equal(op.status,fault==='known'?'failed':'unknown');assert.equal((op.result as any).restoreAvailable,fault==='known');
    await editWordTableBatch(f.broker,'doc',input);assert.equal(f.writes,2);
    if(fault==='known'){f.fail='none';assert.equal((await restoreOperation(f.broker,'partial')).status,'applied');assert.equal(f.state.text[0],'120');}
    else await assert.rejects(restoreOperation(f.broker,'partial'),{code:'RECOVERY_UNAVAILABLE'});
  }finally{f.store.close();}}
});
test('batch owns the document queue, and restoration refuses later external edits',async()=>{
  const f=fixture();try{
    const external=f.selection(3);let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let first=true;
    f.gate=async()=>{if(first){first=false;entered();await waiting;}};
    const batch=editWordTableBatch(f.broker,'doc',{operationId:'queue',reference:f.reference(),edits:[{row:2,column:2,text:'12500'},{row:3,column:2,text:'200'}]});
    await started;const other=formatWordSelection(f.broker,'doc',{operationId:'external',selection:external,font:{italic:true}});await Promise.resolve();assert.equal(f.foreignReadAt,-1);release();
    assert.equal((await batch).status,'applied');assert.equal((await other).status,'conflict');assert.equal(f.foreignReadAt,2);
    f.state.text[1]='manual';assert.equal((await restoreOperation(f.broker,'queue')).status,'conflict');assert.equal(f.writes,2);
  }finally{f.store.close();}
});
test('batch parameters cannot cross table dimensions or single-selection scope',()=>{
  const f=fixture();try{
    const input={operationId:'x',reference:f.reference(),edits:[{row:2,column:2,text:'new'}]};assert.doesNotThrow(()=>wordTableBatchSchema.parse(input));
    for(const edits of [[{row:4,column:2,text:'x'}],[...input.edits,...input.edits],[{row:2,column:2}],[{row:2,column:2,text:'\n'}],[{row:2,column:2,font:{size:1.1}}],[{row:2,column:2,paragraph:{style:'heading1'}}],[{row:2,column:2,paragraph:{}}]])assert.throws(()=>wordTableBatchSchema.parse({...input,edits}));
    const guard=new SelectionGuard();guard.set('chat',{id:'cell',kind:'word'});assert.throws(()=>guard.assert('chat','/tools/table-batch',input),{code:'SELECTION_LOCKED'});
  }finally{f.store.close();}
});
test('batch composes cell paragraph and character properties in one existing format step',async()=>{
  const f=fixture();try{
    const input={operationId:'paragraphs',reference:f.reference(),edits:[{row:2,column:2,text:'12500',font:{bold:true},paragraph:{alignment:'center',spaceAfter:6}},{row:3,column:2,paragraph:{alignment:'right'}}]};
    const op=await editWordTableBatch(f.broker,'doc',input);assert.equal(op.status,'applied');assert.equal(f.writes,3);
    assert.deepEqual(f.paragraphs,[{alignment:1,spaceAfter:6},{alignment:2,spaceAfter:0}]);
    assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.deepEqual(f.paragraphs,[{alignment:0,spaceAfter:0},{alignment:0,spaceAfter:0}]);assert.equal(f.state.text[0],'120');
  }finally{f.store.close();}
});
test('unsupported paragraph preflight in a later cell refuses the batch before any earlier write',async()=>{
  const f=fixture();try{
    const host=f.broker.host('doc');f.broker.attach({binding:host.binding,request:async(method,input:any)=>{
      if(method==='readWordFormat'&&input.paragraphFields?.includes('alignment'))throw Error('WORD_LIST_PARAGRAPH_UNSUPPORTED');
      return host.request(method,input);
    }});
    const op=await editWordTableBatch(f.broker,'doc',{operationId:'preflight',reference:f.reference(),edits:[{row:2,column:2,text:'12500'},{row:3,column:2,paragraph:{alignment:'right'}}]});
    assert.equal(op.status,'failed');assert.equal(f.writes,0);assert.equal((op.result as any).restoreAvailable,false);assert.equal(f.state.text[0],'120');
  }finally{f.store.close();}
});
test('incomplete child journals cannot be advertised as fully restored',async()=>{
  const f=fixture();try{
    const op=await editWordTableBatch(f.broker,'doc',{operationId:'missing',reference:f.reference(),edits:[{row:2,column:2,text:'12500'},{row:3,column:2,text:'200'}]});assert.equal(op.status,'applied');
    const child=(op.result as any).children[0].id;f.store.db.prepare('DELETE FROM operations WHERE id=?').run(child);
    assert.equal((await restoreOperation(f.broker,'missing')).status,'conflict');assert.equal(f.writes,2);
  }finally{f.store.close();}
});
