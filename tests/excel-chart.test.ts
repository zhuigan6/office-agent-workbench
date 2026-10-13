import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutExcelChart} from '../packages/document-workspace/excel-chart.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {excelChartLayoutSchema,excelChartReferenceSchema,excelChartsReadSchema,excelValueAxisSchema} from '../packages/contracts/excel-chart.ts';
import {selectionSchema} from '../packages/contracts/selection.ts';
import {targetSchema} from '../packages/contracts/target.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {planLiveRequest} from '../packages/contracts/live-tools.ts';
import {frozenSelectionContext} from '../packages/contracts/selection-context.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NativeLayoutSummary} from '../apps/workbench/src/NativeOperationView.tsx';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
test('native chart recovery validates template bytes without optional cmdlets and preserves meaningful color maps',{skip:process.platform!=='win32'},()=>{
  for(const suffix of ['',path.sep+'.']){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-chart-guards-'))+suffix;
    const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('../scripts/Verify-ExcelChartGuards.ps1',import.meta.url)),'-Directory',directory],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/EXCEL_CHART_ASSET_AND_COLOR_GUARDS=PASS/);
  }
});
test('native chart component capture cannot silently expand to whole-chart authority',{skip:process.platform!=='win32'},()=>{
  const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('../scripts/Verify-ExcelChartScope.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/EXCEL_CHART_SELECTION_SCOPE=PASS/);
});
test('optional chart format inspection preserves legacy refs and accepts only explicit bounded format guards',()=>{
  const ref={sheet:'Sheet1',name:'Chart1',objectId:'shape:2',hostSessionId:'worker:window',revision:'a'.repeat(64)};
  assert.deepEqual(excelChartReferenceSchema.parse(ref),ref);assert.ok(excelChartReferenceSchema.safeParse({...ref,formatRevision:'b'.repeat(64)}).success);
  assert.ok(!excelChartReferenceSchema.safeParse({...ref,formatRevision:'unknown'}).success);
  assert.equal(excelChartsReadSchema.parse({sheet:'Sheet1'}).includeFormat,undefined);
  assert.equal(excelChartsReadSchema.parse({sheet:'Sheet1',includeFormat:true}).includeFormat,true);
  assert.ok(!excelChartsReadSchema.safeParse({sheet:'Sheet1',includeFormat:'true'}).success);
  const help:any=planLiveRequest({kind:'excel',capabilities:['read']},{action:'help',operation:'excel-charts'});assert.match(help.help.details,/not permission/);
});
test('chart properties combine with geometry only with a format guard and reject arbitrary data/axes',()=>{
  const reference={sheet:'Sheet1',name:'Chart1',objectId:'shape:2',hostSessionId:'worker:window',revision:'a'.repeat(64),formatRevision:'b'.repeat(64)},base={operationId:'format',reference};
  assert.ok(excelChartLayoutSchema.safeParse({...base,geometry:{top:20},properties:{type:'line',title:'Revenue',legend:false,style:4}}).success);
  assert.ok(excelChartLayoutSchema.safeParse({...base,properties:{title:''}}).success);
  for(const properties of [{},{type:'radar'},{title:'bad\ntext'},{style:49},{legend:'false'},{source:'A1:B3'},{axis:{minimum:0}},{template:'C:\\private.crtx'}])assert.ok(!excelChartLayoutSchema.safeParse({...base,properties}).success);
  assert.ok(!excelChartLayoutSchema.safeParse({...base,reference:{...reference,formatRevision:undefined},properties:{title:'new'}}).success);
});
test('primary value-axis properties compose with existing chart formatting and reset explicitly to automatic',()=>{
  assert.ok(excelValueAxisSchema.safeParse({minimum:0,maximum:300,majorUnit:50,minorUnit:10,numberFormat:'0.00'}).success);
  assert.deepEqual(excelValueAxisSchema.parse({minimum:null,maximum:null,majorUnit:null,minorUnit:null,numberFormatLinked:true}),{minimum:null,maximum:null,majorUnit:null,minorUnit:null,numberFormatLinked:true});
  const reference={sheet:'Sheet1',name:'Chart1',objectId:'shape:2',hostSessionId:'worker:window',revision:'a'.repeat(64),formatRevision:'b'.repeat(64)};
  assert.ok(excelChartLayoutSchema.safeParse({operationId:'axis',reference,properties:{type:'line',valueAxis:{minimum:0,maximum:200}}}).success);
  assert.ok(!excelChartLayoutSchema.safeParse({operationId:'axis',reference,properties:{type:'pie',valueAxis:{minimum:0}}}).success);
  assert.ok(!excelChartLayoutSchema.safeParse({operationId:'axis',reference:{...reference,formatRevision:undefined},properties:{valueAxis:{minimum:0}}}).success);
  for(const value of [{},{minimum:300,maximum:100},{minimum:100,maximum:100},{majorUnit:0},{minorUnit:-1},{maximum:Infinity},{maximum:'300'},{minimum:-1e13},{numberFormat:'x\ny'},{numberFormat:'0.00',numberFormatLinked:true},{axisGroup:'secondary'},{scaleType:'logarithmic'}])assert.ok(!excelValueAxisSchema.safeParse(value).success);
});
test('native value-axis planning validates captures, disjoint bounds, automatic flags and source linkage',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('../scripts/Verify-ExcelValueAxisPlan.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/EXCEL_VALUE_AXIS_PLANS=PASS/);
});
test('actual axis receipt and history view distinguish resolved automatic values and avoid sending private snapshots',()=>{
  const valueAxis={scaleType:-4132,minimum:0,maximum:300,minimumAuto:false,maximumAuto:true,majorUnit:50,minorUnit:10,majorUnitAuto:false,minorUnitAuto:true,numberFormat:'0.00',numberFormatLinked:false};
  const receipt=writeToolResult({id:'axis',documentId:'doc',kind:'excel.chart.layout',status:'applied',createdAt:1,updatedAt:1,payload:{},result:{verified:true,code:'VERIFIED',before:{privateTemplate:'secret'},after:{format:{type:4,hasTitle:true,title:'<script>title</script>',hasLegend:false,style:4},geometry:{left:20,top:20,width:400,height:260},valueAxis}}});
  assert.deepEqual(receipt.valueAxis,valueAxis);assert.ok(!JSON.stringify(receipt).includes('privateTemplate'));
  const html=renderToStaticMarkup(createElement(NativeLayoutSummary,{kind:'excel.chart.layout',receipt,recovered:true}));
  assert.ok(html.includes('已恢复'));assert.ok(html.includes('历史')||html.includes('回读记录'));assert.ok(html.includes('自动（回读 300）'));assert.ok(html.includes('0.00'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
test('chart help and frozen context expose compound properties only on rich references',()=>{
  const scope={kind:'excel',capabilities:['read','write']};const help:any=planLiveRequest(scope,{action:'help',operation:'excel-chart-layout'});
  assert.match(help.help.details,/properties require formatRevision/);assert.match(help.help.details,/No source changes/);assert.match(help.help.details,/EXISTING primary linear value axis/);
  const reference={sheet:'Sheet1',name:'Chart1',objectId:'shape:2',hostSessionId:'worker:window',revision:'a'.repeat(64)};
  const base={kind:'excel-chart',documentId:'doc',hostSessionId:reference.hostSessionId,chart:reference,contentHash:reference.revision,preview:'chart'};
  assert.match(frozenSelectionContext('fixed',selectionSchema.parse(base)),/legacy reference permits geometry only/);
  assert.match(frozenSelectionContext('fixed',selectionSchema.parse({...base,chart:{...reference,formatRevision:'b'.repeat(64)}})),/supported type\/title\/legend\/style/);
});
test('chart property journal maps title glyph origins and recovers private assets without duplicate dispatch',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let title='ABoldCD',formatHash='b'.repeat(64),writes=0;
  const ref=()=>({sheet:'Sheet1',name:'Chart1',objectId:'shape:2',hostSessionId:'worker:window',revision:digest(title),formatRevision:formatHash});
  const snap=()=>({reference:ref(),geometry:{left:20,top:20,width:400,height:260},format:{title},template:{file:'local.crtx',sha256:'c'.repeat(64)},titleState:{text:title,profiles:['private']}});
  broker.attach({binding:{documentId:'doc',kind:'excel',hostSessionId:'worker',name:'fixture',capabilities:['read','write'],lastSeen:1},request:async(method,p:any)=>{
    const before=snap();if(p.reference.formatRevision!==formatHash)throw Error('EXCEL_CHART_FORMAT_REVISION_CONFLICT');if(method==='readExcelChartFormat')return before;
    assert.equal(method,'writeExcelChartLayout');writes++;
    if(p.restoreFormat){assert.equal(p.restoreFormat.template.file,'local.crtx');title=p.restoreFormat.format.title;formatHash='b'.repeat(64);}else{assert.equal(p.titleProfileOrigins.length,p.properties.title.length);assert.equal(p.titleProfileOrigins[0],0);assert.equal(p.titleProfileOrigins.at(-1),6);title=p.properties.title;formatHash='d'.repeat(64);}
    return {before,after:snap(),verified:true,revision:ref().revision,code:'VERIFIED'};
  }});
  try{const input={operationId:'format',reference:ref(),properties:{title:'ABnewCD'}},op=await layoutExcelChart(broker,'doc',input);assert.equal(op.status,'applied');assert.equal((await layoutExcelChart(broker,'doc',input)).status,'applied');assert.equal(writes,1);assert.equal((await layoutExcelChart(broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal((await restoreOperation(broker,op.id)).status,'applied');assert.equal(title,'ABoldCD');assert.equal(writes,2);}finally{store.close();}
});
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let geometry:any={left:300,top:100,width:360,height:220},title='Sales',unknown=false,writes=0;
  const snapshot=()=>({reference:{sheet:'Sheet1',name:'Sales chart',objectId:'object1',hostSessionId:'worker:window',revision:digest([geometry,title])},geometry:structuredClone(geometry),content:{title},contentHash:digest(title)});
  broker.attach({binding:{documentId:'doc',kind:'excel',hostSessionId:'worker',name:'fixture',capabilities:['read','write'],lastSeen:1},request:async(method,data:any)=>{
    const before=snapshot();if(data.reference.revision!==before.reference.revision)throw Error('EXCEL_CHART_REVISION_CONFLICT');if(method==='readExcelChart')return before;
    writes++;for(const field of data.fields??Object.keys(data.geometry))geometry[field]=data.restore?data.restore.geometry[field]:data.geometry[field];const after=snapshot();return {before,after,verified:!unknown,revision:after.reference.revision,code:unknown?'READBACK_MISMATCH':'VERIFIED'};
  }});
  const selection=()=>selectionSchema.parse({kind:'excel-chart',documentId:'doc',hostSessionId:'worker:window',chart:snapshot().reference,contentHash:snapshot().reference.revision,preview:'Sales'});
  return {store,broker,snapshot,selection,get writes(){return writes;},manual:()=>geometry.top++,contentEdit:()=>title='User edit',uncertain:()=>unknown=true};
}
test('chart layout composes four properties, deduplicates and restores without content changes',async()=>{
  const f=fixture();try{const before=f.snapshot(),input={operationId:'chart1',reference:before.reference,geometry:{left:400,top:30,width:420,height:260}},op=await layoutExcelChart(f.broker,'doc',input);
    assert.equal(op.status,'applied');assert.deepEqual(f.snapshot().geometry,input.geometry);assert.deepEqual(f.snapshot().content,before.content);assert.equal((await layoutExcelChart(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,1);assert.equal((await layoutExcelChart(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal(f.writes,1);assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.deepEqual(f.snapshot(),before);
  }finally{f.store.close();}
});
test('chart undo does not overwrite later geometry or inspected-content changes',async()=>{
  for(const change of ['manual','contentEdit'] as const){const f=fixture();try{const op=await layoutExcelChart(f.broker,'doc',{operationId:'chart1',reference:f.snapshot().reference,geometry:{top:50}});f[change]();assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.writes,1);}finally{f.store.close();}}
});
test('unknown chart writes cannot be replayed or automatically restored',async()=>{
  const f=fixture();try{f.uncertain();const input={operationId:'chart1',reference:f.snapshot().reference,geometry:{top:50}},op=await layoutExcelChart(f.broker,'doc',input);assert.equal(op.status,'unknown');assert.equal((await layoutExcelChart(f.broker,'doc',input)).status,'unknown');assert.equal(f.writes,1);await assert.rejects(restoreOperation(f.broker,op.id));}finally{f.store.close();}
});
test('chart schema rejects arbitrary properties and cells cannot expand to charts',()=>{
  const f=fixture();try{for(const geometry of [{},{rotation:20},{left:-1},{width:0},{height:4001},{top:Infinity},{top:'20'},{title:'new'}])assert.equal(excelChartLayoutSchema.safeParse({operationId:'chart1',reference:f.snapshot().reference,geometry}).success,false);
    const guard=new SelectionGuard();guard.set('chat',{id:'fixed',kind:'excel'});assert.throws(()=>guard.assert('chat','/tools/excel-chart-layout',{selectionId:'fixed'}),{code:'SELECTION_LOCKED'});
    guard.set('chat',{id:'fixed',kind:'excel-chart'});assert.doesNotThrow(()=>guard.assert('chat','/tools/excel-chart-layout',{selectionId:'fixed'}));assert.throws(()=>guard.assert('chat','/tools/write-selection',{selectionId:'fixed'}),{code:'SELECTION_LOCKED'});assert.throws(()=>guard.assert('chat','/tools/excel-chart-layout',{selectionId:'other'}),{code:'SELECTION_LOCKED'});
  }finally{f.store.close();}
});
test('verified chart continuation keeps exact object/window while permitting another geometry edit',async()=>{
  const f=fixture();try{const tickets=new SelectionTickets(),ticket=tickets.capture('chat',f.selection()),selection=tickets.forOperation(ticket.id,'chat','doc','chart1'),op=await layoutExcelChart(f.broker,'doc',{operationId:'chart1',reference:f.snapshot().reference,geometry:{top:30}},selection);assert.equal(tickets.complete(ticket.id,'chat','doc',op).status,'advanced');const next=tickets.lookup(ticket.id,'chat','doc');assert.ok(next.kind==='excel-chart');assert.deepEqual(next.chart,f.snapshot().reference);assert.equal(next.documentId,'doc');assert.match(frozenSelectionContext(ticket.id,next),/excel-chart-layout/);
    const forged={...op,id:'chart2',result:{...op.result as any,after:{reference:{...f.snapshot().reference,objectId:'different'}}}};tickets.forOperation(ticket.id,'chat','doc','chart2');assert.equal(tickets.complete(ticket.id,'chat','doc',forged).status,'not-advanced');
  }finally{f.store.close();}
});
test('chart target is exclusive with ranges and help uses the existing scoped handler',()=>{
  assert.ok(targetSchema.safeParse({kind:'excel',sheet:'Sheet1',chartName:'Sales chart'}).success);assert.ok(!targetSchema.safeParse({kind:'excel',sheet:'Sheet1'}).success);assert.ok(!targetSchema.safeParse({kind:'excel',sheet:'Sheet1',range:'A1',chartName:'Sales chart'}).success);
  const scope={kind:'excel',capabilities:['read','write']},plan:any=planLiveRequest(scope,{action:'execute',operation:'excel-chart-layout',params:{selectionId:'fixed',operationId:'one',geometry:{top:20}}});assert.equal(plan.route,'/tools/excel-chart-layout');assert.throws(()=>planLiveRequest({kind:'excel',capabilities:['read']},{action:'execute',operation:'excel-chart-layout'}),{code:'LIVE_OPERATION_UNAVAILABLE'});
});
test('chart scope is persisted across guard reload without granting cell writes',()=>{
  const store=new Store(':memory:');try{new SelectionGuard(store.db).set('chat',{id:'fixed',kind:'excel-chart'});const guard=new SelectionGuard(store.db);assert.doesNotThrow(()=>guard.assert('chat','/tools/excel-chart-layout',{selectionId:'fixed'}));assert.throws(()=>guard.assert('chat','/tools/write',{range:'A1'}),{code:'SELECTION_LOCKED'});}finally{store.close();}
});
