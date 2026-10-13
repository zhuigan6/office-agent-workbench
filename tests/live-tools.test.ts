import test from 'node:test';
import assert from 'node:assert/strict';
import {planLiveRequest,scopedOperationNames,scopedLiveRequestShape} from '../packages/contracts/live-tools.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
const word={kind:'word',capabilities:['readText','writeText']};

test('MCP operation names match scoped help exactly and do not advertise unavailable writes',()=>{
  const readonly={kind:'word',capabilities:['readText']},help:any=planLiveRequest(readonly,{action:'help'}),names=scopedOperationNames(readonly);
  assert.deepEqual(names,help.help.operations.map((entry:any)=>entry.operation));const schema=scopedLiveRequestShape(readonly).operation;
  assert.equal(schema.parse('read-text'),'read-text');assert.throws(()=>schema.parse('format-selection'));assert.throws(()=>schema.parse('write-range'));assert.throws(()=>scopedLiveRequestShape({kind:'file',capabilities:[]}));
  assert.equal(scopedLiveRequestShape(word).operation.parse('format-selection'),'format-selection');
});
test('compact live discovery is scoped, local and operation-specific',()=>{
  const page:any=planLiveRequest(word,{action:'help'});
  assert.ok(page.help.operations.some((v:any)=>v.operation==='format-selection'));
  assert.ok(!page.help.operations.some((v:any)=>v.operation==='write-range'));
  assert.ok(!JSON.stringify(page).includes('keepWithNext'));
  const detail:any=planLiveRequest(word,{action:'help',operation:'format-selection'});
  assert.equal(detail.help.example.params.paragraph.alignment,'center');
  assert.ok(detail.help.details.includes('firstLineIndent'));
  const ppt:any=planLiveRequest({kind:'powerpoint',capabilities:['readText','writeText']},{action:'help',operation:'format-selection'});
  assert.equal(ppt.help.example.params.paragraph.alignment,'center');
  assert.equal(ppt.help.example.params.paragraph.lineSpacing.unit,'lines');
  assert.ok(ppt.help.details.includes('COMPLETE paragraphs'));
  assert.equal(ppt.help.paragraph.firstLineIndent,'-1584..1584 points; negative=hanging');
  assert.equal(ppt.help.example.params.paragraph.bullet.type,'numbered');
  const text:any=planLiveRequest({kind:'powerpoint',capabilities:['readText','writeText']},{action:'help',operation:'write-text'});
  assert.equal(text.help.example.params.target.kind,'powerpoint');
});
test('unified execution maps to existing guarded handlers, never arbitrary routes or added permissions',()=>{
  const plan:any=planLiveRequest(word,{action:'execute',operation:'format-selection',params:{selectionId:'fixed',operationId:'one',paragraph:{alignment:'center'}}});
  assert.equal(plan.route,'/tools/format-selection');assert.equal(plan.params.selectionId,'fixed');
  const guard=new SelectionGuard();guard.set('task',{id:'fixed',kind:'word'});
  assert.doesNotThrow(()=>guard.assert('task',plan.route,plan.params));
  assert.throws(()=>guard.assert('task',plan.route,{...plan.params,selectionId:'different'}),{code:'SELECTION_LOCKED'});
  const target:any=planLiveRequest(word,{action:'execute',operation:'target',params:{kind:'word',text:'different'}});
  assert.throws(()=>guard.assert('task',target.route,target.params),{code:'SELECTION_LOCKED'});
  assert.throws(()=>planLiveRequest(word,{action:'execute',operation:'/api/admin/shutdown'}),{code:'LIVE_OPERATION_UNKNOWN'});
  assert.throws(()=>planLiveRequest(word,{action:'execute',operation:'write-range'}),{code:'LIVE_OPERATION_UNAVAILABLE'});
  assert.throws(()=>planLiveRequest({kind:'word',capabilities:['readText']},{action:'execute',operation:'format-selection'}),{code:'LIVE_OPERATION_UNAVAILABLE'});
  assert.throws(()=>planLiveRequest(word,{action:'execute',params:{}}));
  assert.throws(()=>planLiveRequest(word,{action:'help',params:{operationId:'one'}}));
  assert.throws(()=>planLiveRequest(word,{action:'execute',operation:'format-selection',params:[]}));
  assert.throws(()=>planLiveRequest(word,{action:'help',shell:'Save'}));
});
