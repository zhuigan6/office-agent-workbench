import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileToolResult} from '../packages/contracts/file-results.ts';
test('model file receipts retain identifiers and validation but not verbose batch data',()=>{
  const full={file:{id:'file',name:'new.docx'},status:'created',output:{verbose:'x'.repeat(20000)},validation:{exitCode:0,result:{data:{count:0,errors:[]}}}};
  const result=fileToolResult('create',full);
  assert.equal(result.file.id,'file');assert.equal(result.validation.errorCount,0);assert.ok(JSON.stringify(result).length<600);
  assert.equal(full.output.verbose.length,20000);assert.equal(fileToolResult('inspect',full),full);
});
