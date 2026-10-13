import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from '../contracts/index.ts';
import {connectCodexWebSocket} from './codex-websocket.ts';

export function codexStartupHints(stderr:string){
  const rules:[string,RegExp][]=[
    ['arguments-rejected',/unexpected argument|unrecognized (?:argument|option)|unknown (?:argument|option)/i],
    ['address-in-use',/address already in use|EADDRINUSE|os error 10048/i],
    ['permission-denied',/access is denied|permission denied|EACCES|os error 5\b/i],
    ['configuration-invalid',/error (?:loading|parsing) config|failed to (?:load|parse) config|invalid config/i],
    ['authentication-rejected',/unauthorized|invalid (?:capability )?token|authentication failed/i],
  ];
  return rules.filter(([,pattern])=>pattern.test(stderr)).map(([hint])=>hint);
}

export function scopedCodexMcpArgs(config:Record<string,unknown>,keep:string[]){
  if(keep.some(name=>!/^[A-Za-z0-9_-]{1,150}$/.test(name)))throw new AppError('NATIVE_MCP_SCOPE','Document MCP allowlist contains an unsafe override name.',409);
  const retained=new Set(keep),args:string[]=[];
  for(const name of Object.keys(config)){
    if(retained.has(name))continue;
    if(!/^[A-Za-z0-9_-]{1,150}$/.test(name))throw new AppError('NATIVE_MCP_SCOPE','An inherited MCP name cannot be safely scoped with a native override.',409);
    args.push('-c',`mcp_servers.${name}.enabled=false`);
  }
  return args;
}

export function assertScopedCodexMcp(config:unknown,keep:string[]){
  if(!config||typeof config!=='object'||Array.isArray(config)||!keep.length)throw new AppError('NATIVE_MCP_SCOPE','Effective document relay configuration is missing.',409);
  const retained=new Set(keep),entries=Object.entries(config as Record<string,any>);
  if(entries.some(([,value])=>!value||typeof value!=='object'||Array.isArray(value)))throw new AppError('NATIVE_MCP_SCOPE','Effective MCP entries are malformed.',409);
  if(keep.some(name=>!entries.some(([key,value])=>key===name&&value?.enabled!==false))||entries.some(([name,value])=>!retained.has(name)&&value?.enabled!==false))throw new AppError('NATIVE_MCP_SCOPE','An inherited MCP is still active or the document relay is disabled.',409);
}

export async function inspectCodexMcpConfig(binary:string,workspace:string){
  const probe=await startCodexServer(binary,workspace);
  try{
    const reply:any=await probe.rpc.request('config/read',{includeLayers:false,cwd:workspace}),config=reply.config?.mcp_servers;
    if(!config||typeof config!=='object'||Array.isArray(config))throw new AppError('NATIVE_MCP_SCOPE','Effective MCP configuration could not be verified.',409);
    return config as Record<string,unknown>;
  }finally{await probe.stop();}
}

/** One owned app server per linked session. Credentials are never persisted. */
export async function startCodexServer(binary:string,workspace:string,configuration?:{args:string[];env:Record<string,string>}){
  const reservation=createServer();
  await new Promise<void>((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=(reservation.address() as {port:number}).port;
  await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const endpoint='ws://127.0.0.1:'+port,token=randomBytes(32).toString('base64url');
  const child=spawn(binary,[...(configuration?.args??[]),'app-server','--listen',endpoint,'--ws-auth','capability-token','--ws-token-sha256',createHash('sha256').update(token).digest('hex')],{
    cwd:workspace,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...configuration?.env},
  });
  child.stdout.resume();let stderr='',failed=false,spawnCode='';
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});
  child.on('error',(error:NodeJS.ErrnoException)=>{failed=true;spawnCode=/^[A-Z0-9_]{1,40}$/.test(error.code??'')?error.code!:'SPAWN_ERROR';});
  child.stdin.on('error',()=>{});
  let connection:Awaited<ReturnType<typeof connectCodexWebSocket>>|undefined;
  let transportReason='NOT_ATTEMPTED',attempts=0;
  async function stop(){
    await connection?.close();child.stdin.end();
    if(child.pid&&child.exitCode===null&&child.signalCode===null){
      await new Promise<void>(resolve=>{const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});
    }
  }
  try{
    const until=Date.now()+20000;
    while(!failed&&child.exitCode===null&&!connection&&Date.now()<until){
      attempts++;try{connection=await connectCodexWebSocket(endpoint,token);}catch(error){transportReason=error instanceof AppError?error.message.match(/code=([A-Z_]+)/)?.[1]??'HANDSHAKE_FAILED':'HANDSHAKE_FAILED';await delay(200);}
    }
    if(!connection){
      const hints=codexStartupHints(stderr),state=spawnCode?'spawn='+spawnCode:child.exitCode!==null?'exit='+child.exitCode:child.signalCode?'signal='+child.signalCode:'process-running';
      throw new AppError('NATIVE_START_FAILED',`Owned authenticated Codex server did not become ready (${state}; transport=${transportReason}; attempts=${attempts}${hints.length?'; '+hints.join(', '):'; no classified stderr hint'}).`,503);
    }
    child.on('exit',()=>connection?.rpc.close());
    await connection.rpc.initialize();
    return {child,rpc:connection.rpc,endpoint,token,binary,stop};
  }catch(error){await stop();throw error;}
}
