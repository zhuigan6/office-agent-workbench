import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeValidationCache} from '../packages/native-sessions/validation-cache.ts';
test('identical byte identity reuses protocol evidence; changed runtime and new host do not',async()=>{
  const cache=new RuntimeValidationCache<{generation:number}>();let checks=0;const inspect=async()=>({generation:++checks});
  assert.equal((await cache.get('launcherA-binaryA',inspect)).cacheHit,false);
  assert.equal((await cache.get('launcherA-binaryA',inspect)).cacheHit,true);assert.equal(checks,1);
  assert.equal((await cache.get('launcherA-binaryB',inspect)).cacheHit,false);assert.equal(checks,2);
  assert.equal((await new RuntimeValidationCache().get('launcherA-binaryB',inspect)).cacheHit,false);assert.equal(checks,3);
});
test('failed validation is never cached and concurrent identical probes share one inspection',async()=>{
  const cache=new RuntimeValidationCache<number>();let calls=0,resolve!:(value:number)=>void;
  const inspect=()=>{calls++;return new Promise<number>(done=>{resolve=done;});};
  const first=cache.get('same',inspect),second=cache.get('same',inspect);resolve(1);
  assert.equal((await first).cacheHit,false);assert.equal((await second).cacheHit,true);assert.equal(calls,1);
  await assert.rejects(cache.get('changed',async()=>{throw Error('incompatible');}));
  assert.equal((await cache.get('changed',async()=>2)).cacheHit,false);
});
