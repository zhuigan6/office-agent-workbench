import test from 'node:test';
import assert from 'node:assert/strict';
import { writeToolResult } from '../packages/contracts/tool-results.ts';
import type { Operation } from '../packages/contracts/index.ts';

const operation:Operation={id:'op1',documentId:'d1',kind:'excel.write',status:'applied',createdAt:1,updatedAt:2,
  payload:{sheet:'Sheet1',range:'A1',values:[[42]]},result:{verified:true,revision:'r1',before:{values:[[0]]},after:{values:[[42]]},code:'VERIFIED'}};
test('model result omits duplicate matrices while retaining verification evidence',()=>{
  const result=writeToolResult(operation);
  assert.equal(result.verified,true);assert.equal(result.revision,'r1');
  assert.equal('before' in result,false);assert.equal('payload' in result,false);
  assert.ok(JSON.stringify(result).length<JSON.stringify(operation).length);
});
test('uncertain and conflicting edits instruct inspection, not automatic retry',()=>{
  assert.equal(writeToolResult({...operation,status:'unknown'}).verified,false);
  assert.match(writeToolResult({...operation,status:'unknown'}).instruction!,/Do not blindly retry/);
  assert.match(writeToolResult({...operation,status:'conflict'}).instruction!,/Reread/);
});

test('batch summaries retain partial-step evidence without full Office snapshots',()=>{
  const result=writeToolResult({...operation,kind:'ppt.layout.batch',status:'failed',result:{restoreAvailable:true,children:[operation,{...operation,id:'failed',status:'failed'}]}});
  assert.equal(result.verified,false);assert.equal(result.atomic,false);assert.equal(result.steps?.length,2);
  assert.equal(result.restoreAvailable,true);assert.match(result.instruction!,/Do not replay/);
  assert.equal('payload' in result.steps![0],false);
  const children=Array.from({length:40},(_,index)=>({...operation,id:'step_'+index}));
  const word=writeToolResult({...operation,kind:'word.table.batch',result:{verified:true,restoreAvailable:true,children}});
  assert.equal(word.steps?.length,40);assert.equal(word.steps?.at(-1)?.operationId,'step_39');
  assert.equal(writeToolResult({...operation,kind:'ppt.layout.batch',result:{children}}).steps?.length,20);
  assert.equal('payload' in word.steps![0],false);
  const paragraphs=writeToolResult({...operation,kind:'word.paragraph.batch',result:{verified:true,restoreAvailable:true,children:children.slice(0,3)}});
  assert.equal(paragraphs.steps?.length,3);assert.equal(paragraphs.atomic,false);assert.equal('before' in paragraphs,false);
});

test('PPT text recovery profiles stay in the local journal, not the model response',()=>{
  const result=writeToolResult({...operation,kind:'ppt.replace',payload:{selection:{replacementRevision:'rich'},text:'new'},result:{verified:true,revision:'r2',before:{state:{profiles:Array(2000).fill({Name:'Local font',Color:{rgb:42}})}},after:{state:{text:'new'}},code:'VERIFIED'}});
  const text=JSON.stringify(result);
  assert.equal(result.verified,true);assert.equal(result.revision,'r2');
  assert.ok(text.length<500);assert.ok(!text.includes('profiles'));assert.ok(!text.includes('Local font'));
});
test('fitted replacement reports readability without leaking intrinsic glyph snapshots',()=>{
  const receipt=writeToolResult({...operation,kind:'ppt.replace',result:{verified:true,revision:'r2',autoFit:2,minimumFontSize:5,message:'Inspect readability.',layoutCheck:{available:true,mayOverflow:false},beforeNominal:{state:{profiles:[{Size:18,Name:'Private font'}]}}}});
  assert.equal(receipt.autoFit,2);assert.equal(receipt.minimumFontSize,5);assert.equal(receipt.message,'Inspect readability.');assert.equal(receipt.layoutCheck.mayOverflow,false);assert.ok(!JSON.stringify(receipt).includes('Private font'));
});
test('verified fitted formatting keeps visual warnings separate from execution uncertainty',()=>{
  const receipt=writeToolResult({...operation,kind:'ppt.format',result:{verified:true,revision:'r3',autoFit:1,minimumFontSize:18,message:'Inspect layout.',layoutCheck:{available:true,mayOverflow:true},beforeNominal:{state:{profiles:[{Name:'Private original'}]}},afterNominal:{state:{profiles:[{Name:'Private applied'}]}}}});
  assert.equal(receipt.status,'applied');assert.equal(receipt.verified,true);assert.equal(receipt.layoutCheck.mayOverflow,true);assert.equal(receipt.autoFit,1);assert.equal(receipt.minimumFontSize,18);assert.equal(receipt.message,'Inspect layout.');assert.ok(!JSON.stringify(receipt).includes('Private'));
});
test('chart compound receipt reports actual properties without template assets or glyph/source matrices',()=>{
  const receipt=writeToolResult({...operation,kind:'excel.chart.layout',result:{verified:true,revision:'r1',titleLanguageDetected:true,before:{template:{file:'private.crtx'},titleState:{profiles:['private-glyph']}},after:{format:{type:4,title:'Revenue',hasLegend:false,style:4},geometry:{left:20,width:420},sourceState:['private-values']}}});
  assert.equal(receipt.format.title,'Revenue');assert.equal(receipt.geometry.width,420);assert.equal(receipt.restoreAvailable,true);assert.equal(receipt.titleLanguageDetected,true);assert.ok(!JSON.stringify(receipt).includes('private'));
});
