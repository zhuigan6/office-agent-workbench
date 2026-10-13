import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('PPT native font runs preserve arrays, union both APIs and fall back on gaps or mixed profiles',{skip:process.platform!=='win32'},()=>{
  const shell=path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=execFileSync(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./ppt-font-runs.ps1',import.meta.url))],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.match(result,/PPT_FONT_RUNS=PASS/);
});
