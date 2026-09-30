import test from 'node:test';
import assert from 'node:assert/strict';
import { writeToolResult } from '../packages/contracts/tool-results.ts';
import type { Operation } from '../packages/contracts/index.ts';

const operation:Operation={id:'op1',documentId:'d1',kind:'excel.write',status:'applied',createdAt:1,updatedAt:2,
  payload:{sheet:'Sheet1',range:'A1',values:[[42]]},result:{verified:true,revision:'r1',before:{values:[[0]]},after:{values:[[42]]},code:'VERIFIED'}};
test('model result omits duplicate matrices while retaining verification evidence',()=>{
  const result=writeToolResult(operation);
  assert.equal(result.verified,true);assert.equal(result.revision,'r1');
  assert.equal('before' in result,false);assert.equal('payload' in result,false);
  assert.ok(JSON.stringify(result).length<JSON.stringify(operation).length);
});
test('uncertain and conflicting edits instruct inspection, not automatic retry',()=>{
  assert.equal(writeToolResult({...operation,status:'unknown'}).verified,false);
  assert.match(writeToolResult({...operation,status:'unknown'}).instruction!,/Do not blindly retry/);
  assert.match(writeToolResult({...operation,status:'conflict'}).instruction!,/Reread/);
});
