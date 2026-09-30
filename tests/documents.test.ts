import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, revision } from '../packages/document-workspace/store.ts';
import { DocumentBroker } from '../packages/document-workspace/broker.ts';
import { rangeDimensions, validateWrite, type RangeState } from '../packages/contracts/index.ts';

const state: RangeState = { sheetId: 's1', sheetName: 'Sheet1', address: 'A1', values: [[1]], formulas: [[1]], numberFormat: [['General']] };
function fixture() {
  const store = new Store(':memory:');
  const broker = new DocumentBroker(store);
  const calls: string[] = [];
  broker.attach({ binding: {documentId:'d1',hostSessionId:'h1',name:'test',kind:'excel',capabilities:['read','write'],lastSeen:Date.now()},
    async request(method) { calls.push(method); return method === 'read' ? structuredClone(state) : {verified:true,after:{...state,values:[[2]]}}; } });
  return {store,broker,calls};
}
const write = () => ({operationId:'op1',documentId:'d1',sheet:'s1',range:'A1',expectedRevision:revision(state),values:[[2]]});
test('reject unbounded ranges and mismatched matrices', () => {
  assert.throws(() => rangeDimensions('A:A'));
  assert.throws(() => rangeDimensions('A1:XFD1048576'));
  assert.throws(() => validateWrite({...write(),range:'A1:B2'}));
  assert.throws(() => validateWrite({...write(),values:[['=WEBSERVICE("https://example.com")']]}));
});
test('concurrent duplicate requests execute once, changed arguments cannot reuse ID', async () => {
  const {store,broker,calls}=fixture();
  try {
    const results=await Promise.all([broker.write(write()),broker.write(write())]);
    assert.ok(results.every(r=>r.status==='applied'));
    assert.equal(calls.filter(c=>c==='write').length,1);
    await assert.rejects(broker.write({...write(),values:[[3]]}), /different arguments/);
    assert.equal((await broker.write(write())).status,'applied');
  } finally {store.close();}
});
test('stale revision causes conflict without write', async()=>{
  const {store,broker,calls}=fixture();
  try { assert.equal((await broker.write({...write(),expectedRevision:'0'.repeat(64)})).status,'conflict'); assert.ok(!calls.includes('write')); }
  finally {store.close();}
});
test('large cell text requires narrowing the read instead of flooding context or journal',async()=>{
  const {store,broker}=fixture();
  broker.host('d1').request=async()=>({...state,values:[['x'.repeat(512001)]]});
  try{await assert.rejects(broker.read('d1','Sheet1','A1'),{code:'READ_TOO_LARGE'});}
  finally{store.close();}
});
test('lost write response becomes unknown and cannot be retried as new work',async()=>{
  const {store,broker}=fixture(); let writes=0;
  broker.host('d1').request=async(method)=>{if(method==='read')return structuredClone(state);writes++;throw new Error('disconnected');};
  try {const result=await broker.write(write());assert.equal(result.status,'unknown');assert.deepEqual((result.result as any).before.values,state.values);assert.equal((await broker.write(write())).status,'unknown');assert.equal(writes,1);}
  finally {store.close();}
});
test('persisted events can be replayed after a cursor without duplicates',()=>{
  const store=new Store(':memory:');
  try {const a=store.event('a',{});const b=store.event('b',{});assert.deepEqual(store.events(a.sequence).map(e=>e.eventId),[b.eventId]);}
  finally{store.close();}
});
test('restart resolves queued work and retains uncertain writes even beyond the UI history limit',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-restart-'));
  const filename=path.join(dir,'state.db');
  let store=new Store(filename);
  try {
    store.begin('running','d1','excel.write',{});
    store.updateOperation('running','running',{before:state});
    for(let i=0;i<501;i++)store.begin(`queued-${i}`,'d1','excel.write',{});
    store.close();store=new Store(filename);
    assert.equal(store.getOperation('running')?.status,'unknown');
    assert.deepEqual((store.getOperation('running')?.result as any).before,state);
    assert.equal(store.getOperation('queued-0')?.status,'failed');
    assert.equal(store.getOperation('queued-500')?.status,'failed');
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
