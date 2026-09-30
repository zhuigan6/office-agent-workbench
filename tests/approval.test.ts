import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvalChoice,normalizedApproval} from '../packages/contracts/approval.ts';
test('approvals use advertised native and built-in values, never always-allow',()=>{
  const native={id:'permission',call_id:'different-id',options:[{value:'allow_always'},{value:'allow'},{value:'reject'}]};
  assert.equal(approvalChoice(native,true),'allow');assert.equal(approvalChoice(native,false),'reject');
  assert.equal(normalizedApproval(native,true).msg_id,'permission');
  assert.equal(approvalChoice({options:[{value:'proceed_once'},{value:'cancel'}]},true),'proceed_once');
  assert.throws(()=>approvalChoice({options:[{value:'allow_always'}]},true));
  assert.equal(normalizedApproval({options:[]},false).canAllow,false);
});
test('built-in pending approvals resolve unique journal identities without selecting arbitrary messages',()=>{
  const approval={id:'confirmation',call_id:'call1',options:[{value:'allow_once'}]};
  const message={type:'tool_call',msg_id:'public-message',content:{call_id:'aionrs-call1'}};
  assert.equal(normalizedApproval(approval,false,[message]).msg_id,'public-message');
  assert.equal(normalizedApproval(approval,false,[message,message]).msg_id,'public-message');
  assert.equal(normalizedApproval(approval,false,[]).msg_id,undefined);
  assert.equal(normalizedApproval(approval,false,[{...message,content:{call_id:'aionrs-other'}}]).msg_id,undefined);
  assert.equal(normalizedApproval(approval,false,[message,{...message,msg_id:'second'}]).msg_id,undefined);
  assert.equal(normalizedApproval(approval,false,[{...message,type:'text'}]).msg_id,undefined);
  assert.equal(normalizedApproval({...approval,msg_id:'core-supplied'},false,[message]).msg_id,'core-supplied');
});
