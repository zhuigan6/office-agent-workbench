import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HealthMonitor} from '../packages/aioncore-adapter/health.ts';
test('health requires consecutive failures, reports recovery, and stops safely',async()=>{
  let ok=false;const events:boolean[]=[];
  const h=new HealthMonitor(async()=>ok,s=>events.push(s));
  await h.tick();await h.tick();assert.deepEqual(events,[]);
  await h.tick();assert.deepEqual(events,[false]);ok=true;await h.tick();assert.deepEqual(events,[false,true]);
  h.stop();ok=false;await h.tick();assert.deepEqual(events,[false,true]);
});
test('health probes do not overlap or report after shutdown',async()=>{
  let release!:(value:boolean)=>void,calls=0;const events:boolean[]=[];
  const h=new HealthMonitor(()=>{calls++;return new Promise<boolean>(r=>release=r);},s=>events.push(s),1);
  const first=h.tick();await h.tick();assert.equal(calls,1);h.stop();release(false);await first;assert.deepEqual(events,[]);
});
