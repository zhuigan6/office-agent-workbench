import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocketServer,WebSocket} from 'ws';
import {AionCore} from '../packages/aioncore-adapter/index.ts';
import {ManagedPermissionDetails} from '../packages/aioncore-adapter/permission-details.ts';

async function until(check:()=>boolean){
  const deadline=Date.now()+7000;
  while(!check()){if(Date.now()>deadline)throw Error('Event lifecycle observation timed out');await new Promise(resolve=>setTimeout(resolve,20));}
}

test('Core event reconnect has one owner, invalidates approvals and never resends a model request',async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const port=(server.address() as {port:number}).port,sockets:WebSocket[]=[],events:any[]=[],cache=new ManagedPermissionDetails();
  server.on('connection',socket=>sockets.push(socket));
  const core=new AionCore({binary:'unused',dataDir:'unused',port,password:'unused'},event=>{events.push(event);cache.capture(event);});
  const approval={call_id:'p',title:'office_live'},permission={name:'message.stream',data:{conversation_id:'c',turn_id:'t',type:'acp_permission',data:{tool_call:{tool_call_id:'p',title:'office_live',raw_input:{action:'help'}}}}};
  try{
    core.connectEvents();core.connectEvents();await until(()=>events.some(event=>event.name==='core.events.connected'));
    assert.equal(sockets.length,1);
    sockets[0].send(JSON.stringify(permission));await until(()=>cache.enrich(approval,'c','t').permissionDetails.state==='observed');
    sockets[0].terminate();await until(()=>events.some(event=>event.name==='core.events.disconnected'));
    assert.equal(cache.enrich(approval,'c','t').permissionDetails.state,'unavailable');
    await until(()=>events.filter(event=>event.name==='core.events.connected').length===2);
    assert.equal(sockets.length,2);assert.equal(cache.enrich(approval,'c','t').permissionDetails.state,'unavailable');
    sockets[1].send(JSON.stringify(permission));await until(()=>cache.enrich(approval,'c','t').permissionDetails.state==='observed');
    core.socket!.emit('message',Buffer.from(JSON.stringify({name:'one-result',data:null})));
    assert.equal(events.filter(event=>event.name==='one-result').length,1);
    await core.stop();await until(()=>core.socket===undefined);
    core.connectEvents();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(sockets.length,2);
    assert.equal(core.process,undefined,'No runner was spawned during event reconnection');
  }finally{
    await core.stop();for(const socket of sockets)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
