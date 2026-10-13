import test from 'node:test';
import assert from 'node:assert/strict';
import {batchEvidence,FileBatchError} from '../packages/contracts/file-batch.ts';
import {fileToolResult} from '../packages/contracts/file-results.ts';
const summary={total:3,executed:3,succeeded:3,failed:0,skipped:0};
test('batch receipts retain requested reads and discard verbose mutation chatter',()=>{
  const rows=[{index:0,success:true,output:'private mutation chatter'},{index:1,success:true,output:{matches:1,results:[{path:'/p[1]',type:'paragraph',text:'actual read'}]}},{index:2,success:true,output:'raw read'}],execution={exitCode:0,commands:['set','get','raw'],output:{data:{summary,results:rows}}};
  const batch=batchEvidence(execution)!;assert.equal(batch.commandSchemaMatched,true);assert.equal(batch.readResultCount,2);assert.equal(batch.readResults[0].output.data.results[0].text,'actual read');assert.equal(batch.readResults[1].output,'raw read');assert.ok(!JSON.stringify(batch).includes('private mutation chatter'));
  assert.match(batch.readState,/not necessarily/);assert.equal(fileToolResult('batch',{execution}).batch?.readResultCount,2);
});
test('batch evidence adapts only the explicit metadata header and refuses guessed index mappings',()=>{
  const execution={exitCode:0,commands:['meta','get'],output:{data:{summary:{total:1,executed:1,succeeded:1,failed:0,skipped:0},results:[{index:0,success:true,output:'read'}]}}};
  assert.equal(batchEvidence(execution)?.readResults[0].command,'get');
  assert.equal(batchEvidence({...execution,commands:['set','get']})?.commandSchemaMatched,false);
  const bad={...execution,output:{data:{...execution.output.data,results:[{index:99,success:true,output:'not mapped'}]}}};assert.equal(batchEvidence(bad)?.readResultCount,0);
  assert.equal(batchEvidence({output:{data:{summary:{total:'1'},results:[]}}}),undefined);
});
test('large batch reads have an aggregate budget and explicit omissions',()=>{
  const count=30,rows=Array.from({length:count},(_,index)=>({index,success:true,output:{results:[{path:'/p'+index,type:'paragraph',text:'x'.repeat(4000)}]}}));
  const execution={exitCode:0,commands:Array(count).fill('get'),output:{data:{summary:{total:count,executed:count,succeeded:count,failed:0,skipped:0},results:rows}}};
  const batch=batchEvidence(execution)!;assert.ok(JSON.stringify(batch.readResults).length<=8000);assert.ok(batch.omittedReadResults>0);assert.equal(batch.readResultsTruncated,true);assert.equal(batch.readResults.length+batch.omittedReadResults,count);assert.equal(execution.output.data.results.length,count);
});
test('failure evidence is bounded and rollback remains an upstream report, not a native undo claim',()=>{
  const execution={exitCode:1,commands:['set','set'],output:{data:{summary:{total:2,executed:2,succeeded:1,failed:1,skipped:0,atomicRolledBack:true},results:[{index:0,success:true},{index:1,success:false,error:'failure'.repeat(200),code:'not_found',item:{secret:'private source details'}}]}}};
  const batch=batchEvidence(execution)!;assert.equal(batch.failedSteps[0].index,1);assert.ok(batch.failedSteps[0].error.length<=400);assert.equal(batch.upstreamReportedRollback,true);assert.ok(!JSON.stringify(batch).includes('private source details'));
  const error=new FileBatchError({copyPublished:false,batch});assert.equal(error.code,'BATCH_FAILED');assert.equal(error.receipt.copyPublished,false);
});
