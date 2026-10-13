import test from 'node:test';
import assert from 'node:assert/strict';
import {pptLayoutSchema} from '../packages/contracts/ppt-layout.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutPptSelection} from '../packages/document-workspace/ppt-layout.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
const selection={kind:'powerpoint',documentId:'ppt',hostSessionId:'s:1',slideId:'256',shapeIds:['2'],layoutRevision:'a'.repeat(64),contentHash:'a'.repeat(64),preview:'',appearanceProfileVersion:1};
const appearance={fill:{mode:'solid',color:'#204030',transparency:0.2},outline:{mode:'solid',color:'#FFFFFF',width:2}};
test('appearance fingerprint masks exact native hidden records, not text or unknown extensions',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-PptAppearanceFingerprint.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{hiddenAppearanceMask:true,legacyHashUnchanged:true,textAndFontGuard:true,unknownExtensionGuard:true,exactNamespaceAndChildren:true});
});
test('appearance composes with geometry and frame without expanding text citations',()=>{
  assert.doesNotThrow(()=>pptLayoutSchema.parse({operationId:'look',selection,appearance,geometry:{left:72}}));
  assert.doesNotThrow(()=>pptLayoutSchema.parse({operationId:'none',selection,appearance:{fill:{mode:'none'}}}));
  for(const edited of [{}, {fill:{mode:'gradient',color:'#204030'}},{fill:{mode:'solid',color:'red'}},{outline:{mode:'solid',color:'#204030',width:0}},{fill:{mode:'none',color:'#204030'}},{fill:{mode:'solid',color:'#204030',transparency:1.1}}])assert.throws(()=>pptLayoutSchema.parse({operationId:'look',selection,appearance:edited}));
  for(const edited of [{...selection,appearanceProfileVersion:undefined},{...selection,textStart:1,textLength:1},{...selection,shapeIds:['2','3']}])assert.throws(()=>pptLayoutSchema.parse({operationId:'look',selection:edited,appearance}));
});
test('appearance uses existing idempotency, guards and exact original recovery',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let writes=0;
  const original={fill:{visible:0},outline:{visible:-1,weight:1}};
  let state:any={selection,contentHash:selection.layoutRevision,state:{geometry:{left:10,top:20,width:300,height:100,rotation:0},appearance:original}};
  broker.attach({binding:{documentId:'ppt',kind:'powerpoint',hostSessionId:'s',name:'fixture',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,payload:any)=>{
    if(method==='readPptLayout')return structuredClone(state);
    writes++;const before=structuredClone(state);assert.ok(payload.appearance||payload.restoreAppearance);
    state={...state,contentHash:(writes===1?'b':'a').repeat(64),state:{geometry:{...state.state.geometry,...payload.geometry},appearance:payload.restoreAppearance??appearance}};
    return {before,after:state,revision:state.contentHash,verified:true};
  }});
  try{
    const input={operationId:'look',selection,appearance,geometry:{left:72}};
    const operation=await layoutPptSelection(broker,'ppt',input);assert.equal(operation.status,'applied');
    const receipt=writeToolResult(operation);assert.deepEqual(receipt.appearance,appearance);assert.equal(receipt.restoreAvailable,true);assert.equal('before' in receipt,false);
    assert.equal((await layoutPptSelection(broker,'ppt',input)).status,'applied');assert.equal(writes,1);
    assert.equal((await layoutPptSelection(broker,'ppt',{...input,operationId:'stale'})).status,'conflict');assert.equal(writes,1);
    assert.equal((await restoreOperation(broker,'look')).status,'applied');assert.deepEqual(state.state.appearance,original);assert.equal(state.state.geometry.left,10);
  }finally{store.close();}
});
