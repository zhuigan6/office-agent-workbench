import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {NativeOffice} from '../packages/native-office/index.ts';
import {textState} from '../packages/contracts/host-text.ts';
import {DocumentBroker} from '../packages/document-workspace/broker.ts';
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

test('native refresh replaces stale permissions without changing document or session identity',async()=>{
  const native=new NativeOffice('unused','unused');
  const doc={id:'d',kind:'word' as const,name:'test.docx',location:'test.docx',capabilities:['readText','writeText'],saved:true,sessionId:'s'};
  let saved:any;const bindings:any[]=[],events:any[]=[];
  const store:any={documents:()=>saved?[saved]:[],bind:(binding:any)=>{saved=binding;bindings.push(binding);},event:(...event:any[])=>events.push(event)};
  const broker=new DocumentBroker(store);broker.attach(native.host(doc));
  native.discover=async()=>({documents:[{...doc,capabilities:['readText'],writeRestriction:'window-readonly-marker'}],diagnostics:[],sessionId:'s'});
  await native.refreshBound(broker);
  assert.deepEqual(broker.host(native.id(doc)).binding.capabilities,['readText']);assert.equal(saved.hostSessionId,'s');assert.equal(bindings.length,2);
  await native.refreshBound(broker);assert.equal(bindings.length,2);
  native.discover=async()=>({documents:[doc],diagnostics:[],sessionId:'s'});
  await native.refreshBound(broker);assert.deepEqual(saved.capabilities,['readText','writeText']);assert.equal(bindings.length,3);assert.equal(events.length,2);
});
