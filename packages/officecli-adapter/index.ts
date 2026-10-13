import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, validateWrite, type WriteRequest } from '../contracts/index.ts';

export class OfficeCli {
  private checkedStamp = '';
  private checkedDigest = '';
  private helpStamp = '';
  private helpBytes = 0;
  private helpCache = new Map<string, {stdout:string;stderr:string;code:number}>();
  private helpPending = new Map<string,Promise<{stdout:string;stderr:string;code:number}>>();
  constructor(public binary: string, public artifactRoot: string, private expectedSha256?: string) {}
  private async verifyEngine() {
    const identity=async()=>{const resolved=await fs.realpath(this.binary),stat=await fs.stat(resolved,{bigint:true});return `${resolved}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.birthtimeNs}`;};
    const stamp=await identity();
    if(stamp!==this.checkedStamp){
      const digest=createHash('sha256').update(await fs.readFile(this.binary)).digest('hex');
      if(await identity()!==stamp)throw new AppError('ENGINE_VERSION_CHANGED','OfficeCLI changed while its content was being verified.',409);
      if(this.expectedSha256&&digest!==this.expectedSha256)
        throw new AppError('ENGINE_VERSION_CHANGED','OfficeCLI differs from the pinned release. Restore the verified engine before editing files.',409);
      this.checkedStamp=stamp;this.checkedDigest=digest;
    }
    // Metadata prompts a recheck, but only verified bytes define help compatibility.
    return this.checkedDigest;
  }
  async help(args: string[]) {
    if(args.length>4||args.some(value=>typeof value!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(value)))throw new AppError('HELP_ARGUMENT','Use bounded static help arguments.');
    const stamp=await this.verifyEngine();
    if(stamp!==this.helpStamp){this.helpCache.clear();this.helpBytes=0;this.helpStamp=stamp;}
    const key=JSON.stringify([stamp,args]);
    const cached=this.helpCache.get(key);if(cached)return {...cached};
    const pending=this.helpPending.get(key);if(pending)return {...await pending};
    if(this.helpPending.size>=16)throw new AppError('ENGINE_HELP_BUSY','Too many distinct static help requests.',429);
    const request=(async()=>{
      const result=await this.run(['help',...args,'--json']);
      if(await this.verifyEngine()!==stamp)throw new AppError('ENGINE_VERSION_CHANGED','The engine changed while its help was being read.',409);
      const bytes=Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr);
      if(result.code===0&&bytes<=8*1024*1024){
        while(this.helpCache.size&&(this.helpCache.size>=64||this.helpBytes+bytes>8*1024*1024)){
          const oldest=this.helpCache.keys().next().value!;const old=this.helpCache.get(oldest)!;
          this.helpBytes-=Buffer.byteLength(old.stdout)+Buffer.byteLength(old.stderr);this.helpCache.delete(oldest);
        }
        this.helpCache.set(key,{...result});this.helpBytes+=bytes;
      }
      return result;
    })();
    this.helpPending.set(key,request);
    try{return {...await request};}finally{this.helpPending.delete(key);}
  }
  async run(args: string[], input?: string) {
    await this.verifyEngine();
    return new Promise<{stdout:string;stderr:string;code:number}>((resolve,reject)=>{
      const child=spawn(this.binary,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,
        OFFICECLI_NO_AUTO_INSTALL:'1',OFFICECLI_SKIP_UPDATE:'1',OFFICECLI_NO_AUTO_RESIDENT:'1',OFFICECLI_BATCH_ALLOW_STDIN_REDIRECT:'1'}});
      let stdout='',stderr='',settled=false;
      const timer=setTimeout(()=>{child.kill();finish(new AppError('ENGINE_TIMEOUT','OfficeCLI execution timed out.',504));},45000);
      function finish(error?:Error,code=0){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve({stdout,stderr,code});}
      child.on('error',e=>finish(e));
      child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>2_000_000){child.kill();finish(new AppError('ENGINE_OUTPUT_LIMIT','Tool output exceeded the limit.'));}});
      child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-16000);});
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.on('close',code=>finish(undefined,code ?? 1));
      child.stdin.on('error',()=>{});
      child.stdin.end(input);
    });
  }
  async snapshot(base64: string) {
    const bytes=Buffer.from(base64,'base64');
    if(bytes.length<4 || bytes.length>32*1024*1024 || bytes.readUInt16LE(0)!==0x4b50)
      throw new AppError('SNAPSHOT_FORMAT','Expected an OOXML workbook below 32 MB.');
    await fs.mkdir(this.artifactRoot,{recursive:true});
    const id=randomUUID(), filename=path.join(this.artifactRoot,`${id}.xlsx`);
    await fs.writeFile(filename,bytes,{flag:'wx'});
    return {id,filename,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }
  path(id:string) {
    if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('INVALID_ARTIFACT','Invalid artifact ID.');
    return path.join(this.artifactRoot,`${id}.xlsx`);
  }
  async copyBatch(sourceId: string, request: WriteRequest) {
    const data=validateWrite(request);
    const id=randomUUID(),file=this.path(id);
    await fs.copyFile(this.path(sourceId),file,fs.constants.COPYFILE_EXCL);
    const colNumber=(s:string)=>[...s.toUpperCase()].reduce((v,x)=>v*26+x.charCodeAt(0)-64,0);
    const colName=(n:number):string=>n<=26?String.fromCharCode(64+n):colName(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26);
    const start=/^\$?([a-z]+)\$?(\d+)/i.exec(data.range)!;
    const firstCol=colNumber(start[1]),firstRow=Number(start[2]);
    const values=data.values ?? data.formulas ?? data.numberFormat!;
    const commands=values.flatMap((row,r)=>row.map((_,c)=>{
      const props:Record<string,string>={};
      if(data.values)props.value=String(data.values[r][c] ?? '');
      if(data.formulas)props.formula=String(data.formulas[r][c] ?? '').replace(/^=/,'');
      if(data.numberFormat)props.numberformat=data.numberFormat[r][c];
      return {command:'set',path:`/${data.sheet}/${colName(firstCol+c)}${firstRow+r}`,props};
    }));
    const result=await this.run(['batch',file,'--json'],JSON.stringify(commands));
    if(result.code!==0)throw new AppError('ENGINE_FAILED',(result.stderr || result.stdout).slice(0,1200),422);
    return {id,sourceId,result:JSON.parse(result.stdout),sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')};
  }
}
