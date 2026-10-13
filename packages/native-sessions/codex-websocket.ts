import {PassThrough,Writable} from 'node:stream';
import WebSocket from 'ws';
import {AppError} from '../contracts/index.ts';
import {CodexRpc} from './codex-rpc.ts';

/** Thin transport for the original app server. No session engine/reconnect/replay. */
export async function connectCodexWebSocket(endpoint:string,token:string){
  const match=typeof endpoint==='string'?endpoint.match(/^ws:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/):null;
  if(!match||Number(match[1])>65535||typeof token!=='string'||
    !/^[A-Za-z0-9_-]{32,512}$/.test(token))throw new AppError('NATIVE_REMOTE_SCOPE','Use an explicitly authenticated loopback app server.');
  const socket=new WebSocket(endpoint,{headers:{Authorization:'Bearer '+token},maxPayload:8*1024*1024,handshakeTimeout:5000,followRedirects:false});
  await new Promise<void>((resolve,reject)=>{
    const fail=(error:NodeJS.ErrnoException)=>{
      const reason=/Unexpected server response: (401|403)\b/.test(error.message)?'AUTH_REJECTED':error.code==='ECONNREFUSED'?'CONNECTION_REFUSED':/timed out/i.test(error.message)?'HANDSHAKE_TIMEOUT':'HANDSHAKE_FAILED';
      socket.terminate();reject(new AppError('NATIVE_REMOTE_CONNECTION',`Authenticated app-server connection failed (code=${reason}).`));
    };
    socket.once('error',fail);
    socket.once('open',()=>{socket.off('error',fail);resolve();});
  });
  const input=new PassThrough();
  const output=new Writable({write(chunk,_encoding,done){
    if(socket.readyState!==WebSocket.OPEN){done(new AppError('NATIVE_REMOTE_CLOSED','App-server connection closed; no request replayed.'));return;}
    // CodexRpc writes one compact JSON request per chunk with a newline delimiter.
    socket.send(Buffer.from(chunk).toString('utf8').trimEnd(),{binary:false},error=>done(error));
  }});
  const rpc=new CodexRpc(input,output);
  socket.on('message',(data,binary)=>{
    try{
      if(binary)throw Error('Binary RPC frame');
      const parsed=JSON.parse(data.toString());
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid RPC frame');
      input.write(JSON.stringify(parsed)+'\n');
    }catch{rpc.close();socket.close(1002);}
  });
  socket.on('error',()=>rpc.close());socket.on('close',()=>{rpc.close();input.end();output.end();});
  return {rpc,async close(){
    rpc.close();
    if(socket.readyState===WebSocket.CLOSED)return;
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>{socket.terminate();resolve();},1000);socket.once('close',()=>{clearTimeout(timer);resolve();});socket.close();});
  }};
}
