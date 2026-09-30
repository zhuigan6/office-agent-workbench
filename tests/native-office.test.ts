import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {NativeOffice} from '../packages/native-office/index.ts';
import {textState} from '../packages/contracts/host-text.ts';
test('native discovery preserves legacy IDs and disambiguates process instances',{skip:process.platform!=='win32'},()=>{
  const shell=path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=execFileSync(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./native-discovery-keys.ps1',import.meta.url))],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.match(result,/NATIVE_DISCOVERY_KEYS=PASS/);
});
test('native window identities reject blank handles and retain bounded distinct PPT identities',{skip:process.platform!=='win32'},()=>{
  const shell=path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=execFileSync(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./native-window-identity.ps1',import.meta.url))],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.match(result,/NATIVE_WINDOW_IDENTITIES=PASS/);
});

test('Word semantic fingerprint ignores generated rsid but retains text, format and tracked content',{skip:process.platform!=='win32'},()=>{
  const shell=path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=execFileSync(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./native-fingerprint.ps1',import.meta.url))],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.match(result,/NATIVE_FINGERPRINT_TESTS=PASS/);
});
test('native adapter compares a fresh target revision and never retries a stale write',async()=>{
  const native=new NativeOffice('unused','unused');const calls:string[]=[];
  const before={target:{kind:'word' as const,paragraphId:'1'},sessionId:'s',text:'before',contentHash:'a'};
  native.call=async(method)=>{calls.push(method);return method==='readTarget'?before:{before,after:{...before,text:'after',contentHash:'b'}};};
  const host=native.host({id:'d',kind:'word',name:'test.docx',location:'test.docx',capabilities:['readText','writeText'],saved:true,sessionId:'s'});
  const stale=await host.request('writeText',{target:before.target,text:'after',expectedRevision:'0'.repeat(64),operationId:'stale'});
  assert.equal(stale.code,'REVISION_CONFLICT');assert.deepEqual(calls,['readTarget']);
  const valid=await host.request('writeText',{target:before.target,text:'after',expectedRevision:(await textState(before)).revision,operationId:'valid'});
  assert.equal(valid.verified,true);assert.equal(valid.after.text,'after');assert.deepEqual(calls,['readTarget','readTarget','writeText']);
});
