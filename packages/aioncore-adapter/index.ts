import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { AppError } from '../contracts/index.ts';
import {HealthMonitor} from './health.ts';

interface Options { binary:string; dataDir:string; port:number; password:string }
export class AionCore {
  process?: ChildProcess;
  socket?: WebSocket;
  cookies = new Map<string,string>();
  stopping=false;
  monitor?:HealthMonitor;
  constructor(public options:Options,public onEvent:(event:any)=>void=()=>{}) {}
  get url(){return `http://127.0.0.1:${this.options.port}`;}
  headers(extra:Record<string,string>={}) {
    return {'Content-Type':'application/json',Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),
      'x-csrf-token':decodeURIComponent(this.cookies.get('aionui-csrf-token') || ''),...extra};
  }
  async request(method:string,route:string,body?:unknown) {
    const response=await fetch(this.url+route,{method,headers:this.headers(),
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    for(const cookie of response.headers.getSetCookie()){
      const [entry]=cookie.split(';');const split=entry.indexOf('=');this.cookies.set(entry.slice(0,split),entry.slice(split+1));
    }
    const text=await response.text();let result:any;
    try{result=JSON.parse(text);}catch{throw new AppError('CORE_RESPONSE',`Core returned non-JSON (${response.status}).`,502);}
    if(!response.ok||result.success===false)throw new AppError(result.code || 'CORE_ERROR',String(result.error?.message || result.error || result.message || response.status),response.status>=400?response.status:502);
    return result.data ?? result;
  }
  async start() {
    this.stopping=false;
    const {dataDir,binary,port,password}=this.options;
    fs.mkdirSync(dataDir,{recursive:true});
    const marker=path.join(dataDir,'workbench-account.ready');
    if(fs.existsSync(marker)){
      let present=false;try{present=(await fetch(this.url+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
      if(present){await this.request('POST','/login',{username:'admin',password});this.connectEvents();this.monitorHealth();return;}
    }
    if(!fs.existsSync(marker)){
      if(fs.existsSync(path.join(dataDir,'aionui-backend.db')))throw new Error('Core database exists without its Workbench account marker. Inspect before bootstrap.');
      await new Promise<void>((resolve,reject)=>{
        const bootstrap=spawn(binary,['--data-dir',dataDir,'user','set-password','--password-stdin'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        let stderr='';bootstrap.stderr.on('data',d=>{stderr+=d;});
        bootstrap.on('error',reject);bootstrap.on('exit',code=>code===0?resolve():reject(new Error(`Core account bootstrap failed (${code}): ${stderr.slice(-500)}`)));
        bootstrap.stdin.end(password+'\n');
      });
      fs.writeFileSync(marker,'private local account provisioned\n',{flag:'wx'});
    }
    const log=fs.openSync(path.join(dataDir,'process.log'),'a');
    this.process=spawn(binary,['--host','127.0.0.1','--port',String(port),'--data-dir',dataDir,
      '--work-dir',path.join(dataDir,'workspaces'),'--managed-resources-mode','bundled','--log-level','warn'],
      {windowsHide:true,stdio:['ignore',log,log],env:{...process.env,
        ...(fs.existsSync(path.join(dataDir,'..','managed-resources','manifest.json'))?
          {AIONUI_BUNDLED_MANAGED_RESOURCES:path.resolve(dataDir,'..','managed-resources')}:{})}});
    fs.closeSync(log);
    this.process.on('error',e=>this.onEvent({name:'core.error',data:{message:e.message}}));
    this.process.on('exit',code=>{if(!this.stopping)this.onEvent({name:'core.exited',data:{code}});});
    let ready=false;
    for(let i=0;i<100;i++){
      if(this.process.exitCode!==null)throw new Error(`Core exited (${this.process.exitCode}); inspect its local process.log.`);
      try{const r=await fetch(this.url+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,300));
    }
    if(!ready)throw new Error('Core startup timed out.');
    await this.request('POST','/login',{username:'admin',password});
    this.connectEvents();
    this.monitorHealth();
  }
  monitorHealth(){
    this.monitor?.stop();
    this.monitor=new HealthMonitor(async()=>{const r=await fetch(this.url+'/health',{signal:AbortSignal.timeout(3000)});return r.ok;},healthy=>this.onEvent({name:'core.health',data:{healthy}}));
    this.monitor.start();
  }
  connectEvents() {
    if(this.stopping)return;
    if(this.socket&&(this.socket.readyState===WebSocket.CONNECTING||this.socket.readyState===WebSocket.OPEN))return;
    const socket=new WebSocket(this.url.replace('http:','ws:')+'/ws',{headers:this.headers()});this.socket=socket;
    socket.on('open',()=>{if(this.socket===socket&&!this.stopping)this.onEvent({name:'core.events.connected',data:null});});
    socket.on('message',raw=>{
      if(this.socket!==socket||this.stopping)return;
      try{const event=JSON.parse(raw.toString());if(event.name==='ping')socket.send(JSON.stringify({name:'pong',data:null}));else this.onEvent(event);}catch{}
    });
    socket.on('error',()=>{});
    socket.on('close',()=>{
      if(this.socket!==socket)return;
      this.socket=undefined;this.onEvent({name:'core.events.disconnected',data:null});
      if(!this.stopping)setTimeout(()=>this.connectEvents(),2000).unref();
    });
  }
  async stop() {
    this.stopping=true;this.monitor?.stop();this.socket?.close();
    const proc=this.process;
    if(proc&&proc.exitCode===null){proc.kill();await Promise.race([new Promise(r=>proc.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);}
  }
}
