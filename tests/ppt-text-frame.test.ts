import test from 'node:test';
import assert from 'node:assert/strict';
import {pptLayoutSchema} from '../packages/contracts/ppt-layout.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
import {layoutPptSelection} from '../packages/document-workspace/ppt-layout.ts';
import {restoreOperation} from '../packages/document-workspace/recovery.ts';
import {writeToolResult} from '../packages/contracts/tool-results.ts';
test('text-frame edits combine with geometry and require versioned rich capture',()=>{
  const selection={kind:'powerpoint',documentId:'ppt',hostSessionId:'one',slideId:'256',shapeIds:['2'],contentHash:'a'.repeat(64),layoutRevision:'b'.repeat(64),replacementRevision:'c'.repeat(64),preview:'text',frameProfileVersion:1},base={operationId:'one',selection};
  assert.ok(pptLayoutSchema.safeParse({...base,textFrame:{autoFit:'text',marginLeft:12,verticalAnchor:'middle'}}).success);
  assert.ok(pptLayoutSchema.safeParse({...base,geometry:{width:300},textFrame:{wordWrap:false}}).success);
  assert.ok(!pptLayoutSchema.safeParse(base).success);
  assert.ok(!pptLayoutSchema.safeParse({...base,selection:{...selection,frameProfileVersion:undefined},textFrame:{autoFit:'text'}}).success);
  assert.ok(pptLayoutSchema.safeParse({...base,selection:{...selection,frameProfileVersion:undefined},geometry:{left:12}}).success);
  for(const textFrame of [{},{autoFit:'anything'},{marginLeft:-1},{marginTop:1001},{wordWrap:1},{verticalAnchor:'baseline'},{shell:'anything'}])assert.ok(!pptLayoutSchema.safeParse({...base,textFrame}).success);
});
test('native fitting proof verifies controlled sizes, hierarchy/color preservation and automatic geometry',{skip:process.platform!=='win32'},()=>{
  const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-PptFrameProof.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout.trim()),{scale:true,hierarchyGuard:true,colorGuard:true,sizeRestore:true,automaticGeometry:true,positionGuard:true});
});
test('frame recovery includes original real sizes and compact receipts; changes block undo',async()=>{
  const store=new Store(':memory:'),broker=new DocumentBroker(store);let size=18,manual='',writes=0;
  const ref=()=>({kind:'powerpoint',documentId:'ppt',hostSessionId:'one',slideId:'256',shapeIds:['2'],contentHash:digest(size),layoutRevision:digest([size,manual]),replacementRevision:digest([size,manual]),frameProfileVersion:1,preview:'text'}),read=()=>({selection:ref(),contentHash:ref().layoutRevision,state:{geometry:{width:300,height:60,left:40,top:100},textFrame:{AutoSize:size===18?0:2}}});
  broker.attach({binding:{documentId:'ppt',kind:'powerpoint',name:'test',hostSessionId:'one',capabilities:['writeText'],lastSeen:Date.now()},request:async(method,p:any)=>{
    const before=read();if(method==='readPptLayout')return before;writes++;const beforeRich={contentHash:ref().replacementRevision,state:{profiles:[{Size:size,privateMarker:'local-only'}]}};
    if(p.restoreTextFrame){assert.equal(p.restoreTextProfiles[0].Size,18);size=p.restoreTextProfiles[0].Size;}else{assert.equal(p.expectedRichFingerprint,ref().replacementRevision);size=9;}
    const after=read(),afterRich={contentHash:ref().replacementRevision};return {before,after,beforeRich,afterRich,verified:true,revision:after.contentHash,minimumFontSize:size,layoutCheck:{available:true,mayOverflow:false}};
  }});
  try{const input={operationId:'frame',selection:ref(),textFrame:{autoFit:'text'}},op=await layoutPptSelection(broker,'ppt',input);assert.equal(op.status,'applied');const receipt=writeToolResult(op);assert.equal(receipt.minimumFontSize,9);assert.ok(!JSON.stringify(receipt).includes('privateMarker'));await layoutPptSelection(broker,'ppt',input);assert.equal(writes,1);assert.equal((await restoreOperation(broker,op.id)).status,'applied');assert.equal(size,18);const newer=await layoutPptSelection(broker,'ppt',{...input,operationId:'new',selection:ref()});manual='user edit';assert.equal((await restoreOperation(broker,newer.id)).status,'conflict');assert.equal(writes,3);}finally{store.close();}
});
