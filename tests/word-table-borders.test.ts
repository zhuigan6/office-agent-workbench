import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {wordTableLayoutSchema} from '../packages/document-workspace/word-table-layout.ts';
import {layoutWordTable} from '../packages/document-workspace/word-table-layout.ts';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
const reference={tableIndex:1,tableStart:10,rows:3,columns:2,hostSessionId:'word:1',revision:'a'.repeat(64)};
test('table border composition uses strict edge and visible profile parameters',()=>{
  const parse=(borders:unknown)=>wordTableLayoutSchema.parse({operationId:'border',reference,properties:{alignment:'center',columnWidths:[240,120],borders}});
  assert.doesNotThrow(()=>parse({top:{style:'double',width:1.5,color:'#123456'},insideHorizontal:{style:'none'}}));
  for(const bad of [{},{diagonal:{style:'none'}},{top:{style:'none',width:1}},{top:{style:'single',width:0.3,color:'auto'}},{top:{style:'single',width:1}},{top:{style:'single',width:1,color:'red'}},{top:{style:'single',width:1,color:'auto',shell:'anything'}}])assert.throws(()=>parse(bad));
});
test('native border verification covers RGB mapping, unrequested edges and opt-in XML proof',{skip:process.platform!=='win32'},()=>{
  const script=fileURLToPath(new URL('../scripts/Verify-WordTableBorders.ps1',import.meta.url));
  const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout.trim()),{rgb:true,edgeScope:true,mixedRefused:true,xmlScope:true});
});
test('border recovery retains exact edge keys, compact receipts and conflict protection',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let writes=0,manual='',borders={table:{top:{style:1,width:4,color:-16777216}},cells:[{privateSnapshot:true}]};
  const original=structuredClone(borders),ref=()=>({...reference,revision:digest([borders,manual])}),read=()=>({reference:ref(),borders:structuredClone(borders),properties:{alignment:'left'}});
  broker.attach({binding:{documentId:'doc',kind:'word',name:'table',hostSessionId:'one',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    if(p.reference.revision!==ref().revision)throw Error('WORD_TABLE_REVISION_CONFLICT');const before=read();if(method==='readWordTableLayout')return before;
    writes++;if(p.restore){assert.deepEqual(p.borderFields,['top']);borders=structuredClone(p.restore.borders);}else borders.table.top={style:7,width:12,color:5649426};return {before,after:read(),verified:true};
  }});
  try{
    const input={operationId:'edges',reference:ref(),properties:{borders:{top:{style:'double',width:1.5,color:'#123456'}}}};
    const op=await layoutWordTable(broker,'doc',input);assert.equal(op.status,'applied');assert.deepEqual(writeToolResult(op).borders,borders.table);assert.ok(!JSON.stringify(writeToolResult(op)).includes('privateSnapshot'));
    await layoutWordTable(broker,'doc',input);assert.equal(writes,1);assert.equal((await restoreOperation(broker,op.id)).status,'applied');assert.deepEqual(borders,original);
    const newer=await layoutWordTable(broker,'doc',{...input,operationId:'new',reference:ref()});manual='later user edit';assert.equal((await restoreOperation(broker,newer.id)).status,'conflict');assert.equal(writes,3);
  }finally{store.close();}
});
