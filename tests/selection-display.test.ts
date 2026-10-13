import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionPreviewText} from '../apps/workbench/src/selection-display.ts';
test('Word table preview renders cell markers without changing the immutable citation',()=>{
  const selection={kind:'word' as const,documentId:'doc',hostSessionId:'window',storyType:1,start:10,end:40,contentHash:'a'.repeat(64),preview:'Region\r\x07Sales\r\x07\r\x07North\r\x07120\r\x07\r\x07',table:{tableIndex:1,tableStart:10,rows:2,columns:2,hostSessionId:'window',revision:'a'.repeat(64)}};
  const original=JSON.stringify(selection);
  assert.equal(selectionPreviewText(selection),'Region\tSales\nNorth\t120\n');assert.equal(JSON.stringify(selection),original);
  const {table,...paragraph}=selection;assert.equal(selectionPreviewText({...paragraph,preview:'First\rSecond'}),'First\nSecond');
});
test('PPT paragraph and soft-line markers remain visible without changing the frozen payload',()=>{
  const selection={kind:'powerpoint' as const,documentId:'doc',hostSessionId:'window',slideId:'256',shapeIds:['7'],contentHash:'a'.repeat(64),preview:'First\rSecond\u000bMore\r\nFourth'};
  const original=JSON.stringify(selection);assert.equal(selectionPreviewText(selection),'First\nSecond\nMore\nFourth');assert.equal(JSON.stringify(selection),original);
});
