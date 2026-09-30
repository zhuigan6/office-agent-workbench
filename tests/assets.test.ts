import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetProperty,inlineTableCsv} from '../packages/document-workspace/assets.ts';
import {validateBatch} from '../packages/document-workspace/files.ts';
const id='12345678-1234-1234-1234-123456789abc';
test('image fills cannot bypass uploaded-asset authorization',()=>{
  for(const key of ['background','fill','textFill'])for(const value of ['image:C:/private.png','image:https://example.org/a.png',' IMAGE:\\server\\a.png'])
    assert.throws(()=>validateBatch([{command:'set',path:'/slide[1]',props:{[key]:value}}]),{code:'ASSET_REQUIRED'});
  assert.deepEqual(assetProperty('background','image:asset:'+id),{id,prefix:'image:'});
  assert.deepEqual(assetProperty('image','asset:'+id),{id,prefix:''});
  assert.throws(()=>assetProperty('src','asset:../../file'));
  assert.throws(()=>assetProperty('path','C:/private.png'));
  assert.equal(assetProperty('text','image:C:/example.png'),null);
  assert.equal(assetProperty('fill','#ffffff'),null);
  assert.throws(()=>assetProperty('data','https://example.org/a.csv'));
  assert.throws(()=>assetProperty('data','C:\\private.csv'));
  assert.deepEqual(assetProperty('data','asset:'+id),{id,prefix:''});
  assert.equal(assetProperty('data','Sales:10,20,30'),null);
});
test('inline table CSV keeps quoted separators and cannot become a local file lookup',()=>{
  const decode=(s:string)=>Buffer.from(inlineTableCsv(s).split(',')[1],'base64').toString();
  assert.equal(decode('A,B;1,2'),'A,B\n1,2');
  assert.equal(decode('"A;B",C;"D"";E",F'),'"A;B",C\n"D"";E",F');
  assert.equal(decode('secret.csv'),'secret.csv');
  assert.throws(()=>inlineTableCsv('"unclosed'));
});
