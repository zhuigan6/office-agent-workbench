import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFileIntent,type FileRecord} from '../apps/workbench/src/Product.tsx';
const file={id:'exact',name:'same.docx',extension:'docx',mediaType:'docx',size:1,sha256:'hash',createdAt:1} as FileRecord;
test('task result handoff uses the exact task/file version, never a matching name',()=>{
  const intent={requestId:'one',conversation:'task',fileId:'exact',action:'preview' as const};
  assert.equal(resolveFileIntent(intent,'task',[{...file,id:'other'},file]),file);
  assert.throws(()=>resolveFileIntent(intent,'different-task',[file]),/其他任务/);
  assert.throws(()=>resolveFileIntent(intent,'task',[{...file,id:'other'}]),/不可用/);
});
