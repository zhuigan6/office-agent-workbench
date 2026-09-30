import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Operation} from '../packages/contracts/index.ts';
import {recoveryRequest} from '../packages/document-workspace/recovery.ts';
const operation={id:'original',documentId:'doc',kind:'excel.write',status:'applied',payload:{sheet:'Sheet1',range:'A1'},result:{verified:true,revision:'a'.repeat(64),before:{formulas:[['=1+1']],numberFormat:[['0.00']]}},createdAt:0,updatedAt:0} as Operation;
test('recovery targets the exact post-edit revision and retains formulas/formats',()=>{
  const request=recoveryRequest(operation);assert.equal(request.data.expectedRevision,'a'.repeat(64));
  assert.equal(request.data.operationId,recoveryRequest(operation).data.operationId);
  assert.deepEqual((request.data as any).formulas,[['=1+1']]);
  assert.throws(()=>recoveryRequest({...operation,status:'unknown'}));
  assert.throws(()=>recoveryRequest({...operation,id:'restore_original'}));
});
test('text recovery restores only original target text, not unrelated content',()=>{
  const request=recoveryRequest({...operation,kind:'text.write',payload:{target:{kind:'word',paragraphId:'1'}},result:{verified:true,revision:'b'.repeat(64),before:{text:'original'}}});
  assert.deepEqual((request.data as any).target,{kind:'word',paragraphId:'1'});
  assert.equal((request.data as any).text,'original');
});
