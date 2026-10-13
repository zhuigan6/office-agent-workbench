import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,digest,revision} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {styleExcelTable} from '../packages/document-workspace/excel-table.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {excelTableStyleSchema,excelTableReferenceSchema} from '../packages/contracts/excel-table.ts';
import {SelectionTickets} from '../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../packages/document-workspace/selection-guard.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('PowerShell capture retains the COM-style multi-cell object instead of enumerating cells',{skip:process.platform!=='win32'},()=>{const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('../scripts/Verify-ExcelSelectionObject.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/EXCEL_MULTICELL_OBJECT=PASS/);});
function fixture(){
  const store=new Store(':memory:'),broker=new DocumentBroker(store),rangeState={sheetId:'Sheet1',sheetName:'Sheet1',address:'A1:B2',values:[['Name','Sales'],['North',120]],formulas:[['Name','Sales'],['North',120]],numberFormat:[['General','General'],['General','General']]};let properties:any={style:'TableStyleMedium2',showFirstColumn:false,showLastColumn:false,showRowStripes:true,showColumnStripes:false},manual='',unknown=false,writes=0;
  const snapshot=()=>{const hash=digest([properties,rangeState,manual]);return {reference:{sheet:'Sheet1',name:'Sales',objectId:'object1',range:'A1:B2',hostSessionId:'worker:window',revision:hash},properties:structuredClone(properties),rangeState:structuredClone(rangeState),contentHash:hash};};
  broker.attach({binding:{documentId:'doc',kind:'excel',hostSessionId:'worker',name:'fixture',capabilities:['read','write'],lastSeen:1},request:async(method,data:any)=>{const before=snapshot();if(data.reference.revision!==before.reference.revision)throw Error('EXCEL_TABLE_REVISION_CONFLICT');if(method==='readExcelTable')return before;writes++;const fields=data.fields??Object.keys(data.properties);for(const field of fields)properties[field]=data.restore?data.restore.properties[field]:data.properties[field];const after=snapshot();return {before,after,verified:!unknown,revision:after.reference.revision,code:unknown?'READBACK_MISMATCH':'VERIFIED'};}});
  return {store,broker,snapshot,rangeState,get writes(){return writes;},edit:()=>manual='user',uncertain:()=>unknown=true};
}
test('Excel table properties compose/deduplicate/restore while data and formulas stay unchanged',async()=>{
  const f=fixture();try{const before=f.snapshot(),input={operationId:'style',reference:before.reference,properties:{style:'TableStyleLight9',showFirstColumn:true,showRowStripes:false,showColumnStripes:true}};
    const op=await styleExcelTable(f.broker,'doc',input);assert.equal(op.status,'applied');assert.equal((await styleExcelTable(f.broker,'doc',input)).status,'applied');assert.equal(f.writes,1);assert.deepEqual(f.snapshot().rangeState,before.rangeState);
    assert.equal((await styleExcelTable(f.broker,'doc',{...input,operationId:'stale'})).status,'conflict');assert.equal((await restoreOperation(f.broker,op.id)).status,'applied');assert.deepEqual(f.snapshot(),before);
  }finally{f.store.close();}
});
test('later user changes and unknown writes cannot be overwritten or replayed',async()=>{
  for(const unknown of [false,true]){const f=fixture();try{if(unknown)f.uncertain();const input={operationId:'style',reference:f.snapshot().reference,properties:{showFirstColumn:true}},op=await styleExcelTable(f.broker,'doc',input);if(unknown){assert.equal(op.status,'unknown');await assert.rejects(restoreOperation(f.broker,op.id));assert.equal((await styleExcelTable(f.broker,'doc',input)).status,'unknown');assert.equal(f.writes,1);}else{f.edit();assert.equal((await restoreOperation(f.broker,op.id)).status,'conflict');assert.equal(f.writes,1);}}finally{f.store.close();}}
});
test('table schemas and selected turns reject arbitrary properties, partial ranges and substituted targets',()=>{
  const f=fixture();try{const reference=f.snapshot().reference;for(const properties of [{},{style:'evil'},{showTotals:true},{showFirstColumn:'true'},{style:'TableStyleDark12'}])assert.equal(excelTableStyleSchema.safeParse({operationId:'one',reference,properties}).success,false);
    assert.equal(excelTableReferenceSchema.safeParse({...reference,range:'A1:Z1000'}).success,false);const guard=new SelectionGuard();guard.set('chat',{kind:'excel',id:'fixed'});assert.throws(()=>guard.assert('chat','/tools/excel-table-style',{reference}),{code:'SELECTION_LOCKED'});assert.doesNotThrow(()=>guard.assert('chat','/tools/excel-table-style',{selectionId:'fixed'}));
  }finally{f.store.close();}
});
test('verified table-style continuation retains the same object, window, range and numeric revision',async()=>{
  const f=fixture();try{const before=f.snapshot(),selection={kind:'excel' as const,documentId:'doc',hostSessionId:'worker:window',sheet:'Sheet1',range:'A1:B2',preview:'Sales',expectedRevision:revision(before.rangeState),contentHash:before.contentHash,table:before.reference},tickets=new SelectionTickets(),ticket=tickets.capture('chat',selection),fixed=tickets.forOperation(ticket.id,'chat','doc','one');
    const op=await styleExcelTable(f.broker,'doc',{operationId:'one',reference:before.reference,properties:{showFirstColumn:true}},fixed),r=op.result as any,candidate={...selection,table:r.after.reference};
    assert.equal(tickets.complete(ticket.id,'chat','doc',{...op,result:{...r,continuationSelection:candidate}}).status,'advanced');const next=tickets.lookup(ticket.id,'chat','doc');assert.ok(next.kind==='excel');assert.equal(next.table?.revision,r.revision);assert.equal(next.expectedRevision,selection.expectedRevision);
  }finally{f.store.close();}
});
