import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativeDocumentBridge,type NativeToolProvider} from '../packages/native-sessions/document-tools.ts';
import type {CodexRpc} from '../packages/native-sessions/codex-rpc.ts';

class Peer extends EventEmitter {
  replies:{id:string|number;result:any}[]=[];
  respond(id:string|number,result:unknown){this.replies.push({id,result});}
  rejectRequest(id:string|number){this.replies.push({id,result:{denied:true}});}
  call(id:number,change:Record<string,unknown>={}){this.emit('serverRequest',{id,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'call',tool:'office_live',arguments:{action:'help'},...change}});}
}
function fixture(){
  const peer=new Peer(),events:any[]=[];let executions=0,closed=0,active:string|null='turn';
  const provider:NativeToolProvider={document:{taskId:'task',documentId:'doc',name:'Test document'},tools:[{name:'office_live',inputSchema:{type:'object'}}],
    async call(){executions++;return {content:[{type:'text',text:'verified result'}]};},async close(){closed++;}};
  const bridge=new NativeDocumentBridge(peer as unknown as CodexRpc,'thread',provider,event=>events.push(event),()=>{},()=>active);
  return {peer,events,provider,bridge,executions:()=>executions,closed:()=>closed,setActive:(value:string|null)=>{active=value;}};
}
test('one fixed approval executes once; duplicate callbacks and confirmations replay the same result',async()=>{
  const f=fixture();try{
    f.peer.call(1);f.peer.call(2);assert.equal(f.bridge.pending().length,1);assert.equal(f.executions(),0);
    const preview=f.bridge.pending();(preview[0].arguments as any).action='execute';
    assert.equal(f.bridge.pending()[0].arguments.action,'help');
    await f.bridge.confirm('call',true);await f.bridge.confirm('call',true);f.peer.call(3);
    assert.equal(f.executions(),1);assert.equal(f.peer.replies.length,3);assert.equal(f.bridge.busy,false);
    assert.deepEqual(f.events.map(event=>event.kind),['tool.call','tool.result']);
    assert.ok(f.peer.replies.every(reply=>reply.result.success===true));
  }finally{await f.bridge.close();await f.bridge.close();assert.equal(f.closed(),1);}
});
test('denial and expired originating turns do not execute document operations',async()=>{
  const f=fixture();try{
    f.peer.call(1);await f.bridge.confirm('call',false);assert.equal(f.executions(),0);assert.equal(f.peer.replies[0].result.success,false);
    f.peer.call(2,{callId:'second'});f.setActive(null);
    await assert.rejects(f.bridge.confirm('second',true),{code:'NATIVE_APPROVAL_EXPIRED'});assert.equal(f.executions(),0);
    await f.bridge.confirm('second',false);assert.equal(f.bridge.busy,false);
  }finally{await f.bridge.close();}
});
test('foreign sessions, unlisted tools, oversized structures and changed call identities are refused',async()=>{
  const f=fixture();try{
    f.peer.call(1,{threadId:'other'});f.peer.call(2,{tool:'shell'});f.peer.call(3,{namespace:'foreign'});
    f.peer.call(4,{arguments:{text:'x'.repeat(32769)}});assert.equal(f.bridge.pending().length,0);
    f.peer.call(5);f.peer.call(6,{arguments:{action:'execute'}});
    assert.equal(f.bridge.pending().length,1);assert.equal(f.peer.replies.length,5);assert.equal(f.executions(),0);
    assert.ok(f.peer.replies.every(reply=>reply.result.success===false));
  }finally{await f.bridge.close();}
});
test('uncertain MCP failure becomes an inspection result and is never automatically redispatched',async()=>{
  const f=fixture();let calls=0;f.provider.call=async()=>{calls++;throw Error('Connection lost');};
  try{
    f.peer.call(1);await f.bridge.confirm('call',true);f.peer.call(2);await f.bridge.confirm('call',true);
    assert.equal(calls,1);assert.equal(f.peer.replies[0].result.success,false);
    assert.match(f.peer.replies[0].result.contentItems[0].text,/Inspect the existing operation/);
    assert.equal(f.events.at(-1).data.state,'failed');
  }finally{await f.bridge.close();}
});
test('closing a pending bridge denies requests, revokes its provider and removes the handler',async()=>{
  const f=fixture();f.peer.call(1);await f.bridge.close();
  assert.equal(f.peer.replies[0].result.success,false);assert.equal(f.executions(),0);assert.equal(f.peer.listenerCount('serverRequest'),0);
  await assert.rejects(f.bridge.confirm('call',true),{code:'NATIVE_APPROVAL_EXPIRED'});
});

test('standard MCP relay waits for approval, executes once and returns the same cached result',async()=>{
  const f=fixture();try{
    const first=f.bridge.requestMcp('mcp-call','office_live',{action:'help'},'turn');
    const duplicate=f.bridge.requestMcp('mcp-call','office_live',{action:'help'},'turn');
    assert.equal(f.bridge.pending().length,1);assert.equal(f.executions(),0);
    await f.bridge.confirm('mcp-call',true);assert.deepEqual(await first,await duplicate);assert.equal(f.executions(),1);
    assert.deepEqual(await f.bridge.requestMcp('mcp-call','office_live',{action:'help'},'turn'),await first);
    assert.throws(()=>f.bridge.requestMcp('mcp-call','office_live',{action:'execute'},'turn'),{code:'NATIVE_ID_REUSED'});
  }finally{await f.bridge.close();}
});
test('disconnecting an unapproved MCP caller resolves denial without writing',async()=>{
  const f=fixture();try{
    const result=f.bridge.requestMcp('pending','office_live',{action:'help'},'turn');f.bridge.cancel('pending');
    assert.equal((await result).success,false);assert.equal(f.executions(),0);assert.equal(f.bridge.busy,false);
  }finally{await f.bridge.close();}
});
