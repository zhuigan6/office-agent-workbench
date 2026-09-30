import test from 'node:test';
import assert from 'node:assert/strict';
import {readDrafts,acknowledgeDraft,type Draft} from '../apps/workbench/src/drafts.ts';

test('tab drafts restore separate conversation text and attachment references',()=>{
  const value={one:{content:'first',attachments:[]},two:{content:'second',attachments:[{id:'file1',name:'test.docx'}]}};
  assert.deepEqual(readDrafts({getItem:()=>JSON.stringify(value)}),value);
  assert.deepEqual(readDrafts({getItem:()=>'{broken'}),{});
  assert.deepEqual(readDrafts({getItem:()=>{throw Error('storage disabled');}}),{});
});

test('successful send clears only submitted content and preserves newer edits',()=>{
  const submitted:Draft={content:'sent',attachments:[{id:'a',name:'a.docx'} as any]};
  assert.deepEqual(acknowledgeDraft(submitted,submitted),{content:'',attachments:[]});
  const current:Draft={content:'new text',attachments:[...submitted.attachments,{id:'b',name:'b.docx'} as any]};
  assert.deepEqual(acknowledgeDraft(current,submitted),{content:'new text',attachments:[{id:'b',name:'b.docx'}]});
});
