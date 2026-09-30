import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from '../contracts/index.ts';
import {connectCodexWebSocket} from './codex-websocket.ts';

/** One owned app server per linked session. Credentials are never persisted. */
export async function startCodexServer(binary:string,workspace:string){
  const reservation=createServer();
  await new Promise<void>((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=(reservation.address() as {port:number}).port;
  await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const endpoint='ws://127.0.0.1:'+port,token=randomBytes(32).toString('base64url');
  const child=spawn(binary,['app-server','--listen',endpoint,'--ws-auth','capability-token','--ws-token-sha256',createHash('sha256').update(token).digest('hex')],{
    cwd:workspace,windowsHide:true,stdio:['pipe','pipe','pipe'],
  });
  child.stdout.resume();child.stderr.resume();let failed=false;child.on('error',()=>{failed=true;});
  let connection:Awaited<ReturnType<typeof connectCodexWebSocket>>|undefined;
  async function stop(){
    await connection?.close();child.stdin.end();
    if(child.exitCode===null&&child.signalCode===null){
      child.kill();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    }
  }
  try{
    const until=Date.now()+20000;
    while(!failed&&child.exitCode===null&&!connection&&Date.now()<until){
      try{connection=await connectCodexWebSocket(endpoint,token);}catch{await delay(200);}
    }
    if(!connection)throw new AppError('NATIVE_START_FAILED','Owned authenticated Codex server did not become ready.',503);
    child.on('exit',()=>connection?.rpc.close());
    await connection.rpc.initialize();
    return {child,rpc:connection.rpc,endpoint,token,binary,stop};
  }catch(error){await stop();throw error;}
}
