import test from 'node:test';
import assert from 'node:assert/strict';
import {finalPptLayoutChildren} from '../scripts/verification/ppt-task-outcome.ts';
const child=(id:string,overflow:boolean)=>({status:'applied',result:{verified:true,after:{state:{shapeId:id}},layoutCheck:{mayOverflow:overflow}}});
test('final PPT task quality retains earlier warnings without treating corrected states as failures',()=>{
  const operations=[{createdAt:2,status:'applied',result:{children:[child('a',false),child('b',false)]}},{createdAt:1,status:'applied',result:{children:[child('a',true),child('b',false)]}}];
  assert.ok(finalPptLayoutChildren(operations,['a','b']).every(c=>!c.result.layoutCheck.mayOverflow));assert.equal(operations[1].result.children[0].result.layoutCheck.mayOverflow,true);
});
test('final PPT quality cannot hide unknown/partial results, foreign or missing objects',()=>{
  assert.throws(()=>finalPptLayoutChildren([{createdAt:1,status:'unknown',result:{children:[child('a',false)]}}],['a']));
  assert.throws(()=>finalPptLayoutChildren([{createdAt:1,status:'applied',result:{children:[child('b',false)]}}],['a']));
  assert.throws(()=>finalPptLayoutChildren([{createdAt:1,status:'applied',result:{children:[child('a',false)]}}],['a','b']));
});
