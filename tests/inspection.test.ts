import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectionNodes} from '../apps/workbench/src/Inspection.tsx';
test('document inspection recognizes original structured reads but not arbitrary batch or error output',()=>{
  const rows=[{path:'/Sheet1/A1',type:'cell',format:{formula:'SUM(B1:B2)',computedValue:'45'}}];
  assert.deepEqual(inspectionNodes(JSON.stringify({success:true,data:{results:rows}})),rows);
  assert.equal(inspectionNodes({data:{results:[{index:0,success:true}]}}),null);
  assert.equal(inspectionNodes('not JSON'),null);
});
