import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentOptions,validateAgentOption,observedAgentOption} from '../packages/contracts/agent-options.ts';
const model={id:'model',name:'Model',category:'model',type:'select',current_value:'actual',options:[{value:'actual',name:'Actual'}]};
test('agent settings use advertised choices and never expose permission escalation',()=>{
  assert.equal(agentOptions([model,{...model,id:'mode',category:'mode'}]).length,1);
  assert.deepEqual(validateAgentOption([model],'model','actual'),{optionId:'model',value:'actual'});
  assert.throws(()=>validateAgentOption([model],'mode','full-access'));
  assert.throws(()=>validateAgentOption([model],'model','invented'));
  assert.deepEqual(agentOptions(null),[]);
});
test('agent settings require observed confirmation, not optimistic selection',()=>{
  assert.equal(observedAgentOption({confirmation:'observed',config_options:[model]},'model','actual')[0].currentValue,'actual');
  assert.throws(()=>observedAgentOption({confirmation:'pending',config_options:[model]},'model','actual'));
  assert.throws(()=>observedAgentOption({confirmation:'observed',config_options:[model]},'model','different'));
});
