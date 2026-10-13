import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,revision,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {createExcelChart} from '../packages/document-workspace/excel-chart.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {excelChartCreateSchema} from '../packages/contracts/excel-chart.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),state={sheetId:'Sheet1',sheetName:'Sheet1',address:'A1:B3',values:[['Region','Sales'],['North',120],['South',180]],formulas:[['Region','Sales'],['North',120],['South',180]],numberFormat:[['General','General'],['General','General'],['General','General']]};let chart:any=null,packageEdit='',writes=0,unknown=false;
  const source=()=>({sheet:'Sheet1',range:'A1:B3',hostSessionId:'worker:window',revision:revision(state)}),guard=()=>digest([chart?{...chart,packageGuard:undefined}:null,packageEdit]);
  broker.attach({binding:{documentId:'doc',kind:'excel',hostSessionId:'worker',name:'fixture',capabilities:['read','write'],lastSeen:1},request:async(method,data:any)=>{
    if(method==='readExcelChartCreate'){if(chart)throw Error('EXCEL_CHART_NAME_EXISTS');return {source:data.source,sourceState:structuredClone(state),chartIds:[]};}
    if(method==='readExcelChart'){if(!chart||data.reference.revision!==chart.reference.revision)throw Error('EXCEL_CHART_REVISION_CONFLICT');return structuredClone(chart);}
    if(method==='writeExcelChartCreate'){writes++;chart={reference:{sheet:'Sheet1',name:data.name,objectId:'shape:1',hostSessionId:'worker:window',revision:digest(data.geometry)},geometry:data.geometry,content:{type:data.type,title:data.title},sourceState:structuredClone(state)};chart.packageGuard={hash:guard()};return {before:data.before,after:structuredClone(chart),revision:chart.reference.revision,verified:!unknown,code:unknown?'CHART_CREATE_PARTIAL':'VERIFIED'};}
    if(data.expectedGuard!==guard()||data.source.revision!==revision(state))return {verified:false,notIssued:true,code:'REVISION_CONFLICT'};writes++;chart=null;return {verified:true,removed:true,code:'VERIFIED',revision:digest('removed')};
  }});
  return {store,broker,state,source,input:()=>({operationId:'create1',source:source(),name:'SalesChart',type:'column',title:'Sales'}),get chart(){return chart;},get writes(){return writes;},edit:()=>packageEdit='user style edit',uncertain:()=>unknown=true};
}
test('chart creation composes/defaults, preserves cells, deduplicates and removes only its own guarded object',async()=>{
  const f=fixture();try{const before=structuredClone(f.state),input=f.input(),op=await createExcelChart(f.broker,'doc',input);assert.equal(op.status,'applied');assert.equal(f.chart.content.title,'Sales');assert.deepEqual(f.chart.geometry,{left:300,top:20,width:360,height:240});assert.deepEqual(f.state,before);assert.equal((await createExcelChart(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,1);assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.equal(f.chart,null);assert.deepEqual(f.state,before);}finally{f.store.close();}
});
test('later rich-style or source edits block deletion even when chart geometry is unchanged',async()=>{
  for(const sourceEdit of [false,true]){const f=fixture();try{const op=await createExcelChart(f.broker,'doc',f.input());if(sourceEdit)f.state.values[1][1]=999;else f.edit();assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.ok(f.chart);assert.equal(f.writes,1);}finally{f.store.close();}}
});
test('stale source and existing names are stopped before chart creation; unknown creation is not replayed',async()=>{
  const f=fixture();try{const input=f.input();f.state.values[1][1]=999;assert.equal((await createExcelChart(f.broker,'doc',input)).status,'conflict');assert.equal(f.writes,0);f.uncertain();const fresh={...f.input(),operationId:'unknown'},op=await createExcelChart(f.broker,'doc',fresh);assert.equal(op.status,'unknown');assert.equal((await createExcelChart(f.broker,'doc',fresh)).status,'unknown');await assert.rejects(restoreOperation(f.broker,op.id));assert.equal((await createExcelChart(f.broker,'doc',{...f.input(),operationId:'duplicateName'})).status,'failed');assert.equal(f.writes,1);}finally{f.store.close();}
});
test('create schema rejects arbitrary types, oversized ranges and titles, names, styles and geometry',()=>{
  const f=fixture();try{const input=f.input();for(const extra of [{type:'vba'},{source:{...input.source,range:'A1:Z1000'}},{source:{...input.source,range:'A1:B1'}},{source:{...input.source,range:'A1:C3'},type:'pie'},{name:''},{name:'bad\nname'},{title:'bad\ntext'},{style:49},{geometry:{width:0}},{geometry:{shell:'cmd'}}])assert.equal(excelChartCreateSchema.safeParse({...input,...extra}).success,false);}finally{f.store.close();}
});
test('creation retains the frozen source citation rather than granting authority over the new chart',async()=>{
  const f=fixture();try{const tickets=new SelectionTickets(),selected={kind:'excel' as const,documentId:'doc',hostSessionId:'worker:window',sheet:'Sheet1',range:'A1:B3',expectedRevision:revision(f.state),contentHash:digest(f.state),preview:'Sales source'},ticket=tickets.capture('chat',selected),fixed=tickets.forOperation(ticket.id,'chat','doc','create1'),op=await createExcelChart(f.broker,'doc',f.input(),fixed);assert.equal(tickets.complete(ticket.id,'chat','doc',op).status,'advanced');assert.deepEqual(tickets.lookup(ticket.id,'chat','doc'),selected);const guard=new SelectionGuard();guard.set('chat',{kind:'excel',id:ticket.id});assert.doesNotThrow(()=>guard.assert('chat','/tools/excel-chart-create',{selectionId:ticket.id}));assert.throws(()=>guard.assert('chat','/tools/excel-chart-layout',{selectionId:ticket.id}),{code:'SELECTION_LOCKED'});}finally{f.store.close();}
});
test('model result exposes a compact new-chart reference, not source matrices or package snapshots',async()=>{
  const f=fixture();try{const op=await createExcelChart(f.broker,'doc',f.input()),result=writeToolResult(op);assert.equal(result.chart?.reference.name,'SalesChart');assert.equal(result.chart?.geometry.width,360);assert.equal(result.restoreAvailable,true);assert.ok(!JSON.stringify(result).includes('numberFormat'));assert.ok(!JSON.stringify(result).includes('packageGuard'));}finally{f.store.close();}
});
