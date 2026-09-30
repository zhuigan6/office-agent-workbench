import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionAnswer} from '../packages/contracts/questions.ts';
test('structured answers retain exact question text and distinguish decline from empty allow',()=>{
  const q={questions:[{question:'Which?',multiSelect:false},{question:'Tags?',multiSelect:true}]};
  assert.deepEqual(questionAnswer(q,{decline:true}),{decline:true});
  const answers=[{question:'Which?',labels:['custom answer']},{question:'Tags?',labels:['A','B']}];
  assert.deepEqual(questionAnswer(q,{answers}),{answers});
  assert.throws(()=>questionAnswer(q,{answers:[]}));
  assert.throws(()=>questionAnswer(q,{decline:true,answers}));
  assert.throws(()=>questionAnswer(q,{answers:[answers[0],answers[0]]}));
  assert.throws(()=>questionAnswer(q,{answers:[{question:'Which?',labels:['A','B']},answers[1]]}));
});
