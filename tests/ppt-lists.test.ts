import test from 'node:test';
import assert from 'node:assert/strict';
import {pptParagraphSchema,pptFormatSchema} from '../packages/contracts/ppt-format.ts';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('lists and indents compose but reject invalid kinds, sizes, Unicode and numbering',()=>{
  for(const bullet of [{type:'none'},{type:'character',character:8226,relativeSize:0.8},{type:'numbered',style:3,start:3}])assert.ok(pptParagraphSchema.safeParse({leftIndent:24,firstLineIndent:-12,rightIndent:6,bullet}).success);
  for(const bullet of [{},{type:'none',relativeSize:1},{type:'picture'},{type:'character',character:13},{type:'character',character:55296},{type:'character',character:65536},{type:'character',character:8226,relativeSize:0.1},{type:'numbered',style:41,start:1},{type:'numbered',style:3,start:0},{type:'numbered',style:3.2,start:1},{type:'numbered',style:3,start:1,shell:'x'}])assert.ok(!pptParagraphSchema.safeParse({bullet}).success);
  for(const v of [{leftIndent:-1},{rightIndent:1585},{firstLineIndent:-1585},{leftIndent:Infinity}])assert.ok(!pptParagraphSchema.safeParse(v).success);
});
test('legacy references keep original formatting scope; new list/indent captures are versioned',()=>{
  const selection={kind:'powerpoint',documentId:'ppt',hostSessionId:'one',slideId:'256',shapeIds:['2'],contentHash:'a'.repeat(64),replacementRevision:'b'.repeat(64),preview:'text'},base={operationId:'one',selection};
  assert.ok(pptFormatSchema.safeParse({...base,font:{bold:true},paragraph:{alignment:'center'}}).success);
  assert.ok(!pptFormatSchema.safeParse({...base,paragraph:{leftIndent:24}}).success);
  assert.ok(!pptFormatSchema.safeParse({...base,paragraph:{bullet:{type:'none'}}}).success);
  assert.ok(pptFormatSchema.safeParse({...base,selection:{...selection,paragraphProfileVersion:1},paragraph:{leftIndent:24,bullet:{type:'none'}}}).success);
  assert.ok(!pptFormatSchema.safeParse({...base,selection:{...selection,paragraphProfileVersion:2},font:{bold:true}}).success);
});
test('native bullet verification tolerates Single rounding, not wrong symbols or pictures',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-PptBulletProfile.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{floatReadback:true,wrongCharacterRejected:true,numberPlan:true,jsonRestore:true,pictureRefused:true});
});
