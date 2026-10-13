import test from 'node:test';
import assert from 'node:assert/strict';
import {pptSlideBounds} from '../packages/contracts/ppt-slide-bounds.ts';
test('native rectangle slide check distinguishes frame fit from canvas clipping',()=>{
  const size={width:960,height:540};assert.equal(pptSlideBounds({left:60,top:300,width:230,height:260.12,rotation:0},size)?.mayClip,true);
  assert.equal(pptSlideBounds({left:60,top:250,width:230,height:260.12,rotation:0},size)?.mayClip,false);
  const rotated=pptSlideBounds({left:10,top:10,width:300,height:50,rotation:45},size);assert.ok(rotated?.bounds.top!<0);assert.equal(rotated?.mayClip,true);
  assert.equal(pptSlideBounds({left:0,top:0,width:960,height:540,rotation:0},size)?.mayClip,false);
  assert.equal(pptSlideBounds({left:NaN,top:0,width:100,height:100,rotation:0},size),undefined);
  assert.equal(pptSlideBounds({left:0,top:0,width:100,height:100,rotation:0},undefined),undefined);
});
