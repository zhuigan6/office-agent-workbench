import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('PPT frame fingerprint ignores proofing dirty bits, not content or style',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Verify-PptFrameFingerprint.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()),{proofingIgnored:true,identicalRunsMerged:true,runStyleGuard:true,fontGuard:true,textGuard:true,colorGuard:true,languageGuard:true,nativePackagesMatch:null});
});
