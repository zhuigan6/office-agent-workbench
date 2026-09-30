import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportedUsage} from '../packages/contracts/usage.ts';
test('usage reports only finite upstream values and never invents billing',()=>{
  const u=reportedUsage({used:100,size:1000,cost:{amount:0.01,currency:'USD'},_meta:{input_tokens:50,cached_read_tokens:20}});
  assert.equal(u.contextUsed,100);assert.equal(u.amount,0.01);assert.equal(u.outputTokens,null);assert.equal(u.billingVerified,false);
  assert.equal(reportedUsage(null).available,false);
  assert.equal(reportedUsage({used:Infinity,cost:{amount:-1,currency:'secret-token'}}).amount,null);
  assert.equal(reportedUsage({used:NaN}).contextUsed,null);
});
