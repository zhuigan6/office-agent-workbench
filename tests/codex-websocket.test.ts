import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {connectCodexWebSocket} from '../packages/native-sessions/codex-websocket.ts';
test('remote transport requires exact authenticated loopback spelling without route/redirect escapes',async()=>{
  const token='a'.repeat(32);
  for(const endpoint of ['ws://localhost:1234','wss://127.0.0.1:1234','ws://127.0.0.1:65536','ws://127.0.0.1:1234/path','ws://evil.example:1234'])await assert.rejects(connectCodexWebSocket(endpoint,token),{code:'NATIVE_REMOTE_SCOPE'});
  await assert.rejects(connectCodexWebSocket('ws://127.0.0.1:1234','short'),{code:'NATIVE_REMOTE_SCOPE'});
});
test('original RPC works over authenticated text frames; sockets close without replay or leaked credentials',async()=>{
  const token='b'.repeat(32),server=createServer(),sockets=new WebSocketServer({noServer:true});
  server.on('upgrade',(req,socket,head)=>{if(req.headers.authorization!=='Bearer '+token){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));});
  let requests=0;
  sockets.on('connection',socket=>socket.on('message',frame=>{
    const value=JSON.parse(frame.toString());if(value.id===undefined)return;requests++;
    socket.send(JSON.stringify({id:value.id,result:value.method==='initialize'?{serverInfo:{version:'fixture'}}:{data:[]}},null,2));
  }));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint='ws://127.0.0.1:'+(server.address() as any).port;
  let connection:Awaited<ReturnType<typeof connectCodexWebSocket>>|undefined;
  try{
    await assert.rejects(connectCodexWebSocket(endpoint,'c'.repeat(32)),error=>error instanceof Error&&error.message.includes('code=AUTH_REJECTED')&&!error.message.includes(token));
    connection=await connectCodexWebSocket(endpoint,token);await connection.rpc.initialize();
    assert.deepEqual(await connection.rpc.request('model/list',{}),{data:[]});assert.equal(requests,2);
    await connection.close();await assert.rejects(connection.rpc.request('model/list',{}));assert.equal(requests,2);
  }finally{await connection?.close();for(const socket of sockets.clients)socket.terminate();await new Promise<void>(resolve=>sockets.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
