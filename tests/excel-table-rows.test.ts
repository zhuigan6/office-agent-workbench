import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest,revision} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {appendExcelTable} from '../packages/document-workspace/excel-table.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {excelTableRowsSchema,excelAppendGeometry,excelSheetsReadSchema} from '../packages/contracts/excel-table.ts';
import {planLiveRequest} from '../packages/contracts/live-tools.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {nativeExcelMatrixMatches} from '../packages/contracts/native-excel-values.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('shared native scalar setter preserves heterogeneous types and suppresses COM return values',{skip:process.platform!=='win32'},()=>{const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('../scripts/Verify-ExcelScalarSetter.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/EXCEL_TYPED_SCALAR_SETTER=PASS/);});
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),original=[['Region','Sales'],['North',120]],profiles={style:'TableStyleMedium2'};let values:any[][]=structuredClone(original),tail='blank',occupied=false,unknown=false,writes=0;
  const snapshot=()=>{const range='A1:B'+values.length,state={sheetId:'Sheet1',sheetName:'Sheet1',address:range,values:structuredClone(values),formulas:structuredClone(values),numberFormat:values.map(()=>['General','General'])},reference={sheet:'Sheet1',name:'Sales',objectId:'object1',range,hostSessionId:'worker:window',revision:digest([values,profiles])};return {reference,rangeState:state,shape:{rows:values.length,columns:2},properties:profiles,tail:{hash:tail}};};
  broker.attach({binding:{documentId:'doc',kind:'excel',hostSessionId:'worker',name:'fixture',capabilities:['read','write'],lastSeen:1},request:async(method,data:any)=>{
    const before=snapshot();if(data.reference.revision!==before.reference.revision)throw Error('EXCEL_TABLE_REVISION_CONFLICT');
    if(method==='readExcelTable')return before;
    if(method==='readExcelTableAppend'){if(occupied)throw Error('EXCEL_APPEND_REQUIRES_EMPTY_NORMAL_CELLS');return {table:before,tail:{hash:'blank'},rowsAdded:data.append.length};}
    if(data.restore&&tail!==data.expectedTailHash)return {notIssued:true,verified:false,code:'REVISION_CONFLICT'};
    writes++;if(data.restore){values=structuredClone(original);tail='blank';}else{values.push(...structuredClone(data.append));tail='styled';}
    const after=snapshot();return {before:data.restore?before:{table:before,tail:{hash:'blank'}},after,verified:!unknown,revision:after.reference.revision,code:unknown?'READBACK_MISMATCH':'VERIFIED'};
  }});
  return {store,broker,snapshot,get writes(){return writes;},setOccupied:()=>occupied=true,setUnknown:()=>unknown=true,editTail:()=>tail='user-format'};
}
test('append keeps column count and rejects out-of-sheet/oversize/structural matrices',()=>{
  assert.deepEqual(excelAppendGeometry('B4:D6',2),{expanded:'B4:D8',tail:'B7:D8',columns:3,rows:3,count:2});
  const ref={sheet:'Sheet1',name:'Sales',objectId:'1',range:'A1:B2',hostSessionId:'w',revision:'a'.repeat(64)};
  for(const update of [{append:[]},{append:[[1]]},{append:[[1,2]],formulas:[['=A1']]},{append:[['=1+1',2]]},{append:[['bad\ntext',2]]},{reference:{...ref,range:'A1048575:B1048576'}}])assert.equal(excelTableRowsSchema.safeParse({operationId:'one',reference:ref,append:[[1,2]],...update}).success,false);
});
test('append deduplicates, rejects old range/version and restores only the known added tail',async()=>{
  const f=fixture();try{const before=f.snapshot(),input={operationId:'rows',reference:before.reference,append:[['South',180],['West',240]]};const op=await appendExcelTable(f.broker,'doc',input);assert.equal(op.status,'applied');assert.equal(f.snapshot().reference.range,'A1:B4');assert.equal((await appendExcelTable(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,1);assert.equal((await appendExcelTable(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.deepEqual(f.snapshot(),before);
  }finally{f.store.close();}
});
test('occupied destinations refuse before resize, tail formatting changes refuse restore, unknown is never replayed',async()=>{
  for(const mode of ['occupied','format','unknown']){const f=fixture();try{if(mode==='occupied')f.setOccupied();if(mode==='unknown')f.setUnknown();const input={operationId:'rows',reference:f.snapshot().reference,append:[['South',180]]},op=await appendExcelTable(f.broker,'doc',input);if(mode==='occupied'){assert.equal(op.status,'failed');assert.equal(f.writes,0);}else if(mode==='format'){f.editTail();assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.writes,1);}else{assert.equal(op.status,'unknown');await assert.rejects(restoreOperation(f.broker,op.id));assert.equal((await appendExcelTable(f.broker,'doc',input)).status,'unknown');assert.equal(f.writes,1);}}finally{f.store.close();}}
});
test('row continuation expands only the same explicit table by the requested row count',async()=>{
  const f=fixture();try{const before=f.snapshot(),selection={kind:'excel' as const,documentId:'doc',hostSessionId:'worker:window',sheet:'Sheet1',range:'A1:B2',preview:'Sales',expectedRevision:revision(before.rangeState),contentHash:before.reference.revision,table:before.reference},tickets=new SelectionTickets(),ticket=tickets.capture('chat',selection),fixed=tickets.forOperation(ticket.id,'chat','doc','rows'),op=await appendExcelTable(f.broker,'doc',{operationId:'rows',reference:before.reference,append:[['South',180]]},fixed),r=op.result as any,candidate={...selection,range:r.after.reference.range,table:r.after.reference,expectedRevision:revision(r.after.rangeState)};
    const bad={...candidate,range:'B1:C3',table:{...candidate.table,range:'B1:C3'}};assert.equal(tickets.complete(ticket.id,'chat','doc',{...op,result:{...r,continuationSelection:bad}}).status,'not-advanced');assert.equal(tickets.complete(ticket.id,'chat','doc',{...op,result:{...r,continuationSelection:candidate}}).status,'advanced');assert.equal((tickets.lookup(ticket.id,'chat','doc') as any).range,'A1:B3');assert.equal(ticket.selection.kind==='excel'&&ticket.selection.range,'A1:B2');
  }finally{f.store.close();}
});
test('native empty-cell/formula-constant readback normalization never coerces value types or formula text',()=>{
  assert.equal(nativeExcelMatrixMatches([['text',12.5,true,null]],[['text',12.5,true,'']]),true);assert.equal(nativeExcelMatrixMatches([[12]],[['12']]),false);assert.equal(nativeExcelMatrixMatches([[12]],[['12']],true),true);assert.equal(nativeExcelMatrixMatches([['=IF(1,"hello","bye")']],[['=IF(1,"HELLO","bye")']],true),false);
});
test('workbook outline is bounded read-only discovery, not permission to retarget or write',()=>{
  assert.deepEqual(excelSheetsReadSchema.parse({}),{start:0,count:20});for(const input of [{count:51},{start:-1},{workbook:'other.xlsx'},{activate:true}])assert.equal(excelSheetsReadSchema.safeParse(input).success,false);
  assert.deepEqual(planLiveRequest({kind:'excel',capabilities:['read']},{action:'execute',operation:'excel-sheets',params:{start:0,count:2}}),{route:'/tools/excel-sheets',params:{start:0,count:2}});assert.throws(()=>planLiveRequest({kind:'word',capabilities:['readText']},{action:'execute',operation:'excel-sheets'}),{code:'LIVE_OPERATION_UNAVAILABLE'});
  const guard=new SelectionGuard();guard.set('chat',{kind:'excel',id:'fixed'});assert.doesNotThrow(()=>guard.assert('chat','/tools/excel-sheets',{}));assert.throws(()=>guard.assert('chat','/tools/write',{sheet:'Other',range:'A1'}),{code:'SELECTION_LOCKED'});
});
