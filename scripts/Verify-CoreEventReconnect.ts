import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {local,loadConfig} from '../apps/local-host/config.ts';
import {httpsTransport} from '../packages/client/index.ts';
import {AionCore} from '../packages/aioncore-adapter/index.ts';

const config=loadConfig(),ca=new X509Certificate(await fs.readFile(path.join(local,'server.cer'))).toString();
async function request(route:string){const result=await httpsTransport({url:new URL(`https://localhost:${config.port}${route}`),method:'GET',headers:{Authorization:'Bearer '+config.uiToken},ca,timeoutMs:10000});assert.equal(result.status,200);return JSON.parse(result.body.toString());}
const before=await request('/health'),tasksBefore=await request('/api/conversations');assert.equal(before.coreReady,true);
assert.ok(!tasksBefore.some((task:any)=>task.turn),'Inspect reconnect only while original tasks are idle');
const events:string[]=[],core=new AionCore({binary:config.aioncore,dataDir:path.join(local,'core-data'),port:config.corePort,password:config.coreSecret},event=>events.push(event.name));
async function until(check:()=>boolean){const deadline=Date.now()+15000;while(!check()){if(Date.now()>deadline)throw Error('Owned observer event reconnect timed out');await new Promise(resolve=>setTimeout(resolve,50));}}
const report:any={checkedAt:new Date().toISOString(),modelRequests:0,documentWrites:0,ownedObserverOnly:true,passed:false};
try{
  await core.request('POST','/login',{username:'admin',password:config.coreSecret});
  core.connectEvents();core.connectEvents();await until(()=>events.includes('core.events.connected'));
  const original=core.socket!;original.terminate();await until(()=>events.includes('core.events.disconnected'));
  await until(()=>events.filter(name=>name==='core.events.connected').length===2);
  assert.notEqual(core.socket,original);assert.equal(core.process,undefined);
  const after=await request('/health'),tasksAfter=await request('/api/conversations');assert.equal(after.pid,before.pid);assert.equal(after.coreReady,true);
  assert.deepEqual(tasksAfter.map((task:any)=>[task.id,task.turn]),tasksBefore.map((task:any)=>[task.id,task.turn]));
  Object.assign(report,{sameHostPid:after.pid,connectedEvents:2,disconnectedEvents:1,taskExecutionStateUnchanged:true,passed:true});
}catch(error){report.error=error instanceof Error?error.message:'Event observation failed';throw error;}
finally{
  await core.stop();const directory=await fs.mkdtemp(path.join(local,'verification/core-event-reconnect-'));
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}));
}
