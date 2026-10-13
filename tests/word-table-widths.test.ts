import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutWordTable,wordTableLayoutSchema} from '../packages/document-workspace/word-table-layout.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
test('column widths compose with layout but must describe every bounded column',()=>{
  const reference={tableIndex:1,tableStart:10,rows:3,columns:2,hostSessionId:'one',revision:'a'.repeat(64)},base={operationId:'one',reference};
  assert.deepEqual(wordTableLayoutSchema.parse({...base,properties:{columnWidths:[240,120],alignment:'center'}}).properties.columnWidths,[240,120]);
  for(const columnWidths of [[],[120],[10,120],[240,NaN],[240,1001],[240,18.01],[240,120,80]])assert.throws(()=>wordTableLayoutSchema.parse({...base,properties:{columnWidths}}));
});
test('width preflight persists before dispatch; same receipt and guarded restore reuse the existing journal',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let writes=0,activeId='one';const old={columns:[216,216],cells:[],preferredType:1,preferred:0,allowAutoFit:true};let widths=structuredClone(old),manual='';
  const reference=()=>({tableIndex:1,tableStart:10,rows:3,columns:2,hostSessionId:'one',revision:digest([widths,manual])}),read=()=>({reference:reference(),properties:{alignment:'left'},rowBreaks:[true,true,true],widths:structuredClone(widths)});
  broker.attach({binding:{documentId:'doc',kind:'word',name:'table',hostSessionId:'one',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(p.reference.revision!==reference().revision)throw Error('WORD_TABLE_REVISION_CONFLICT');const before=read();if(method==='readWordTableLayout'){assert.ok(p.properties?.columnWidths||p.restore.widths);return before;}
    assert.ok((store.getOperation(p.restore?'restore_'+digest(activeId).slice(0,48):activeId)?.result as any).before.widths);writes++;widths=p.restore?structuredClone(p.restore.widths):{...widths,columns:[...p.properties.columnWidths],preferredType:3,preferred:360,allowAutoFit:false};return {before,after:read(),verified:true};
  }});
  try{const request={operationId:'one',reference:reference(),properties:{columnWidths:[240,120]}},op=await layoutWordTable(broker,'doc',request);assert.equal(op.status,'applied');assert.deepEqual(writeToolResult(op).columnWidths,[240,120]);assert.ok(JSON.stringify(writeToolResult(op)).length<1000);await layoutWordTable(broker,'doc',request);assert.equal(writes,1);assert.equal((await restoreOperation(broker,'one')).status,'applied');assert.deepEqual(widths,old);assert.equal(writes,2);
    activeId='new';const newer=await layoutWordTable(broker,'doc',{...request,operationId:'new',reference:reference()});manual='changed';assert.equal((await restoreOperation(broker,newer.id)).status,'conflict');assert.equal(writes,3);
  }finally{store.close();}
});
test('width normalization never weakens legacy proof or ignores border/fill/content changes',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-WordTableWidthsXml.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{requestedWidthsOnly:true,legacyWidthGuard:true,unrelatedChangesRejected:5});
});
test('dedicated Word fixture diagnostics cannot accidentally omit a conditional for-loop iterator',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-WordFixtureLoops.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr);const proof=JSON.parse(result.stdout.trim());assert.equal(proof.scripts,3);assert.ok(proof.boundedLoops>=10);
});
test('width modules guard no-op alignment and apply preferred units/autofit after other layout setters',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-WordWidthSetterGuards.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{unchangedAlignmentGuards:3,widthPlanLast:true});
});
