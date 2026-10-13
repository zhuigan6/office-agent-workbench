import test from 'node:test';
import assert from 'node:assert/strict';
import {validateModelTaskPlan,validateModelTaskReadback} from '../scripts/verification/model-task-cases.ts';
test('synthetic model task scope excludes external paths, commands, assets and formulas',()=>{
  const safe=[{command:'add',parent:'/body',type:'paragraph',props:{text:'Quarterly report'}},{command:'add',parent:'/body',type:'paragraph',props:{text:'Body'}},{command:'add',parent:'/styles',type:'style',props:{id:'ReportTitle'}},{command:'add',parent:'/body',type:'table',props:{data:'Region,Sales;North,120;South,180'}}];assert.deepEqual(validateModelTaskPlan(0,safe),safe);
  for(const changed of [{...safe[0],parent:'C:\\private'},{...safe[0],props:{src:'https://example.com'}},{...safe[0],command:'remove'},{...safe[0],props:{text:'file:C:/secret'}}])assert.throws(()=>validateModelTaskPlan(0,[changed,...safe.slice(1)]));
  const excel=[{command:'add',parent:'/',type:'sheet',props:{name:'Data'}},{command:'set',path:'/Data/A1',props:{value:'10'}},{command:'set',path:'/Data/A2',props:{value:'20'}},{command:'set',path:'/Sheet1/A1',props:{formula:'SUM(Data!A1:A2)'}},{command:'add',parent:'/Sheet1',type:'chart',props:{data:'Sales:10,20'}}];assert.deepEqual(validateModelTaskPlan(1,excel),excel);
  for(const formula of ['1+1','WEBSERVICE("https://example.com")'])assert.throws(()=>validateModelTaskPlan(1,excel.map((command,index)=>index===3?{...command,props:{formula}}:command)));
});
test('task readback requires actual structure and calculated result, not only execution success',()=>{
  assert.throws(()=>validateModelTaskReadback({args:['get','/body'],includes:['Required title']},'{"success":true}'));
  assert.throws(()=>validateModelTaskReadback({args:['get','/Sheet1/A1'],includes:['SUM(Data!A1:A2)','0.00'],computed:'30'},JSON.stringify({data:{results:[{format:{formula:'SUM(Data!A1:A2)',numberformat:'0.00',computedValue:'20'}}]}})));
});
