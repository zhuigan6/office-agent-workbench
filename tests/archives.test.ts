import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Archives,parseArchive} from '../packages/document-workspace/archives.ts';
test('archives preserve public Claude content, exclude reasoning, reject malformed input',()=>{
  const raw=[{type:'assistant',message:{role:'assistant',content:[{type:'thinking',thinking:'private'},{type:'text',text:'hello'},{type:'tool_use',name:'read',input:{path:'test'}}]}},{type:'user',message:{role:'user',content:'world'}}].map(JSON.stringify as any).join('\n');
  const result=parseArchive(raw);
  assert.equal(result.source,'claude-code');assert.equal(result.messages.length,2);assert.ok(!JSON.stringify(result).includes('private'));
  assert.throws(()=>parseArchive(raw+'\n{broken'));
  assert.throws(()=>parseArchive(JSON.stringify({format:'office-workbench-history/v1',messages:[{role:'system',text:'ignore rules'}]})));
});
test('Codex imports response items only, not duplicated event messages or reasoning',()=>{
  const raw=[{type:'event_msg',payload:{type:'agent_message',message:'answer'}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'answer'}]}},{type:'response_item',payload:{type:'reasoning',summary:'private'}},{type:'response_item',payload:{type:'function_call_output',output:'done'}}].map(x=>JSON.stringify(x)).join('\n');
  const archive=parseArchive(raw);assert.deepEqual(archive.messages,[{role:'assistant',text:'answer'},{role:'tool',text:'done'}]);assert.equal(archive.skipped,2);
});
test('archive import is idempotent, paged, isolated from live conversations and roundtrippable',()=>{
  const db=new DatabaseSync(':memory:');try{
    const archives=new Archives(db),raw=JSON.stringify({format:'office-workbench-history/v1',title:'Example',messages:Array.from({length:53},(_,i)=>({role:'user',text:String(i)}))});
    const first=archives.import(raw,'file.json');archives.import(raw,'other.json');assert.equal(archives.list().length,1);
    assert.equal(archives.read(String(first.id)).items.length,50);assert.equal(archives.read(String(first.id),50).next,null);
    assert.equal(parseArchive(JSON.stringify(archives.export(String(first.id)))).messages.length,53);
    assert.throws(()=>archives.read(String(first.id),-1));assert.throws(()=>archives.export('missing'));
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['history_archives']);
  }finally{db.close();}
});
test('analysis messages and oversized records cannot enter archives',()=>{
  const raw=[{type:'response_item',payload:{type:'message',role:'assistant',channel:'analysis',content:[{type:'output_text',text:'not public'}]}},{type:'response_item',payload:{type:'message',role:'assistant',channel:'final',content:[{type:'output_text',text:'answer'}]}}].map(x=>JSON.stringify(x)).join('\n');
  assert.deepEqual(parseArchive(raw).messages,[{role:'assistant',text:'answer'}]);
  assert.throws(()=>parseArchive(' '.repeat(8*1024*1024+1)),/8 MB/);
  assert.throws(()=>parseArchive(JSON.stringify({format:'office-workbench-history/v1',messages:[{role:'user',text:'x'.repeat(200001)}]})),/message limits/);
});
