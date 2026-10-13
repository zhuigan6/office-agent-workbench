import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('Word window markers only restrict writes and supplement native readonly/protection guards',{skip:process.platform!=='win32'},()=>{
  const shell=path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const output=execFileSync(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./word-readonly.ps1',import.meta.url))],{encoding:'utf8',timeout:15000,windowsHide:true});assert.match(output,/WORD_READONLY_GUARDS=PASS/);
});
