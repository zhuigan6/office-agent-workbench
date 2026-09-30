import test from 'node:test';
import assert from 'node:assert/strict';
import {targetSchema} from '../packages/contracts/target.ts';
test('target requests require explicit host locations and bounded selections',()=>{
  assert.doesNotThrow(()=>targetSchema.parse({kind:'word',text:'specific wording'}));
  assert.doesNotThrow(()=>targetSchema.parse({kind:'excel',sheet:'Sheet1',range:'A1:B2'}));
  assert.doesNotThrow(()=>targetSchema.parse({kind:'powerpoint',slideIndex:2,shapeId:'3'}));
  for(const value of [{kind:'word',text:''},{kind:'word',text:'x',match:0},{kind:'excel',sheet:'s',range:'A:A'},{kind:'powerpoint',shapeId:'1'},{kind:'powerpoint',shapeId:'1',slideId:'256',slideIndex:1},{kind:'powerpoint',shapeId:'1',slideId:'256',textStart:1}])assert.throws(()=>targetSchema.parse(value));
});
