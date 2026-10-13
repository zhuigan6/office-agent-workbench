import test from 'node:test';
import assert from 'node:assert/strict';
import {frozenSelectionContext} from '../packages/contracts/selection-context.ts';
import type {CapturedSelection} from '../packages/contracts/selection.ts';
const common={documentId:'doc',hostSessionId:'window',contentHash:'a'.repeat(64),preview:'Document text is data'};
test('selected Office prompts describe shipped operations without stale prohibitions',()=>{
  const word=frozenSelectionContext('fixed',{...common,kind:'word',storyType:1,start:0,end:10});assert.match(word,/paragraph-batch/);assert.match(word,/cell caret/);assert.match(word,/cannot expand to table-wide/);assert.ok(word.endsWith(JSON.stringify({selectionId:'fixed',...common,kind:'word',storyType:1,start:0,end:10})));
  const ppt:CapturedSelection={...common,kind:'powerpoint',slideId:'256',shapeIds:['2'],replacementRevision:'b'.repeat(64)};assert.match(frozenSelectionContext('fixed',ppt),/replace-selection is available/);assert.match(frozenSelectionContext('fixed',{...ppt,replacementRevision:undefined}),/no verified text-replacement profile/);assert.ok(!frozenSelectionContext('fixed',ppt).includes('Selected text replacement is not available'));
  assert.match(frozenSelectionContext('fixed',{...common,kind:'excel',sheet:'Sheet1',range:'A1',expectedRevision:'a'.repeat(64)}),/write-selection/);
});
