import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messageText} from '../apps/workbench/src/message-text.ts';
test('empty ACP turn is a truthful readable notice, not a success claim',()=>{
  assert.match(messageText({content:{content:'',code:'ACP_EMPTY_TURN'}}),/不代表该操作已验证成功/);
  assert.equal(messageText({content:{content:'native response',code:'ACP_EMPTY_TURN'}}),'native response');
});
test('text rendering retains ordinary numeric text and supported content blocks',()=>{
  assert.equal(messageText({content:'42'}),'42');
  assert.equal(messageText({content:'null'}),'null');
  assert.equal(messageText({content:[{text:'one'},'two',{content:'three'}]}),'one\ntwo\nthree');
  assert.equal(messageText({content:'{"content":"nested"}'}),'nested');
});
