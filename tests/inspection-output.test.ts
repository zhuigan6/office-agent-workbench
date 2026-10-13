import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedInspection} from '../packages/contracts/inspection-output.ts';
import {inspectionNodes} from '../apps/workbench/src/Inspection.tsx';
test('small original engine inspection passes unchanged, without a second document renderer',()=>{
  const output={success:true,data:{results:[{path:'/Sheet1/A1',type:'cell',text:'original'}]}};
  assert.equal(boundedInspection(output).output,output);assert.equal(boundedInspection(output).truncated,false);
});
test('large inspection retains whole objects and valid structured rendering with explicit omission counts',()=>{
  const rows=Array.from({length:100},(_,i)=>({path:'/Sheet1/A'+(i+1),type:'cell',text:'\u9500\u552e'.repeat(250),children:[{path:'/nested',type:'run',text:'unchanged'}]})),source={success:true,data:{count:100,results:rows}};
  const result=boundedInspection(source,2000),output:any=result.output;
  assert.equal(result.truncated,true);assert.ok(JSON.stringify(output).length<=2000);assert.ok(output.data.results.length>0);assert.ok(output.data.results.length<100);
  assert.deepEqual(output.data.results,rows.slice(0,output.returnedResultCount));assert.equal(output.returnedResultCount+output.omittedResultCount,100);
  assert.deepEqual(inspectionNodes(output),output.data.results);assert.match(result.narrowing!,/partial/);assert.equal(source.data.results.length,100);
});
test('oversized first object or metadata is reported, never mid-JSON sliced or falsely returned in full',()=>{
  for(const source of [{data:{results:[{path:'/huge',type:'paragraph',text:'x'.repeat(10000)}]}},{metadata:'x'.repeat(10000),data:{results:[]}},{text:'x'.repeat(10000)}]){
    const result=boundedInspection(source,1000),output:any=result.output;assert.equal(result.truncated,true);assert.equal(output.partial,true);assert.ok(JSON.stringify(output).length<=1000);assert.match(result.narrowing!,/smaller/);
  }
});
test('text inspection bounds escaped output and never splits a surrogate pair',()=>{
  const text=('"\\\n\ud83d\ude00').repeat(1000),result=boundedInspection(text,1000);
  assert.equal(typeof result.output,'string');assert.ok(JSON.stringify(result.output).length<=1000);assert.ok(!/[\uD800-\uDBFF]$/.test(result.output as string));assert.equal(result.truncated,true);
});
