import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {DatabaseSync} from 'node:sqlite';
test('selected turns reject legacy writes, different references and file mutations',()=>{
  const guard=new SelectionGuard();guard.set('chat',{id:'fixed',kind:'word'});
  for(const route of ['/tools/write','/tools/write-text','/tools/write-selection'])assert.throws(()=>guard.assert('chat',route,{selectionId:'fixed'}),{code:'SELECTION_LOCKED'});
  for(const action of ['create','batch','merge','import'])assert.throws(()=>guard.assert('chat','/tools/file',{action}),{code:'SELECTION_LOCKED'});
  assert.throws(()=>guard.assert('chat','/tools/replace-selection',{selectionId:'later'}),{code:'SELECTION_LOCKED'});
  assert.doesNotThrow(()=>guard.assert('chat','/tools/replace-selection',{selectionId:'fixed'}));
  assert.doesNotThrow(()=>guard.assert('chat','/tools/format-selection',{selectionId:'fixed'}));
  for(const action of ['list','help','inspect'])assert.doesNotThrow(()=>guard.assert('chat','/tools/file',{action}));
});
test('guard is task-local and only new message context removes or replaces it',()=>{
  const guard=new SelectionGuard(),input={id:'fixed',kind:'excel' as const};guard.set('one',input);input.id='changed';
  assert.doesNotThrow(()=>guard.assert('one','/tools/write-selection',{selectionId:'fixed'}));
  assert.doesNotThrow(()=>guard.assert('other','/tools/write',{}));
  guard.set('one',{id:'ppt',kind:'powerpoint'});
  assert.throws(()=>guard.assert('one','/tools/replace-selection',{selectionId:'ppt'}),{code:'SELECTION_LOCKED'});
  guard.set('one');assert.doesNotThrow(()=>guard.assert('one','/tools/write',{}));
});
test('a recreated guard retains restrictions and does not unlock stale references',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    new SelectionGuard(db).set('chat',{id:'old',kind:'word'});
    const restarted=new SelectionGuard(db);
    assert.throws(()=>restarted.assert('chat','/tools/write-text',{}),{code:'SELECTION_LOCKED'});
    restarted.set('chat');assert.doesNotThrow(()=>new SelectionGuard(db).assert('chat','/tools/write-text',{}));
  }finally{db.close();}
});
