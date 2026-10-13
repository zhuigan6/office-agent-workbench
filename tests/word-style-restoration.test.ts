import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
test('Word style recovery allows only unused nondefault additions, not content or active style changes',{skip:process.platform!=='win32'},async()=>{
  const executable=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=await promisify(execFile)(executable,['-NoProfile','-NonInteractive','-File',path.resolve('tests/word-style-restoration.ps1')],{windowsHide:true,timeout:20000});
  assert.match(result.stdout,/WORD_STYLE_EQUIVALENCE=PASS/);
});
