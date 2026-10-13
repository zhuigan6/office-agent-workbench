import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {AppError,canonical,rangeDimensions,validateWrite,type DocumentBinding,type RangeState} from '../contracts/index.ts';
import {textState,hostTextReadSchema,hostTextWriteSchema,assertPageSize} from '../contracts/host-text.ts';
import {revision} from '../document-workspace/store.ts';
import {selectionSchema,type CapturedSelection} from '../contracts/selection.ts';
import {targetSchema} from '../contracts/target.ts';
import {DocumentBroker,type Host} from '../document-workspace/broker.ts';
import {nativeExcelMatrixMatches} from '../contracts/native-excel-values.ts';

interface NativeDocument {id:string;kind:DocumentBinding['kind'];name:string;location:string;capabilities:string[];saved:boolean;sessionId:string;windowIds?:string[];instanceId?:string;processId?:number;discoverySource?:string;writeRestriction?:string|null}
export class NativeOffice {
  child?:ChildProcessWithoutNullStreams;
  pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  stderr='';
  constructor(public appRoot:string,public dataRoot:string){}
  async start(){
    if(this.child&&!this.child.killed)return;
    if(process.platform!=='win32')throw new AppError('WINDOWS_REQUIRED','Live Office integration requires Windows desktop Office. File tasks work independently.');
    const snapshots=path.join(this.dataRoot,'native-snapshots');await fs.mkdir(snapshots,{recursive:true});
    if(this.child&&!this.child.killed)return;
    const binary=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(binary,['-NoProfile','-NonInteractive','-STA','-File',path.join(this.appRoot,'packages/native-office/bridge.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,WORKBENCH_NATIVE_SNAPSHOTS:snapshots}});
    this.child=child;child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');this.stderr='';
    child.stderr.on('data',s=>{this.stderr=(this.stderr+s).slice(-4000);});
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{try{const reply=JSON.parse(line);const task=this.pending.get(reply.id);if(!task)return;this.pending.delete(reply.id);clearTimeout(task.timer);reply.error?task.reject(new AppError('NATIVE_OFFICE',String(reply.error),422)):task.resolve(reply.result);}catch{}});
    const end=(message:string)=>{if(this.child===child)this.child=undefined;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new AppError('NATIVE_OFFLINE',message,503));}this.pending.clear();lines.close();};
    child.on('error',e=>end(e.message));child.on('exit',code=>end(`Office connector exited (${code}). ${this.stderr.slice(-1200)}`));child.stdin.on('error',()=>{});
  }
  async call(method:string,documentId?:string,payload?:unknown):Promise<any>{
    await this.start();const child=this.child!;const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);child.kill();reject(new AppError('NATIVE_TIMEOUT','Office did not respond. A write may have happened; inspect before retrying.',504));},45000);
      this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,documentId,payload})+'\n',e=>{if(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
    });
  }
  async discover():Promise<{documents:NativeDocument[];diagnostics:any[];sessionId:string}>{return this.call('discover');}
  id(doc:NativeDocument){return `native:${doc.kind}:${doc.id}`;}
  async captureSelection(documentId:string){
    const found=await this.discover(),doc=found.documents.find(item=>this.id(item)===documentId);
    if(!doc)throw new AppError('NATIVE_DOCUMENT_OFFLINE','The bound document is not currently accessible.',409);
    const captured=await this.call('selection',doc.id);
    return this.normalizeSelection(captured,documentId);
  }
  private normalizeSelection(captured:any,documentId:string){
    if(captured.kind==='excel'){
      if(!captured.state||captured.state.sheetName!==captured.sheet||captured.state.address!==captured.range.toUpperCase().replaceAll('$',''))throw new AppError('SELECTION_STATE','Native selection state does not match its target.',409);
      captured.expectedRevision=revision(captured.state);delete captured.state;
    }
    return selectionSchema.parse({...captured,documentId});
  }
  async resolveTarget(documentId:string,input:unknown){
    const data=targetSchema.parse(input),found=await this.discover(),doc=found.documents.find(item=>this.id(item)===documentId);
    if(!doc)throw new AppError('NATIVE_DOCUMENT_OFFLINE','The bound document is unavailable.',409);
    if(doc.kind!==data.kind)throw new AppError('HOST_KIND','Target belongs to another Office application.');
    const result=await this.call('target',doc.id,data);
    if(result.status!=='resolved')return result;
    return {status:'resolved',selection:this.normalizeSelection(result.selection,documentId)};
  }
  async verifySelectionIdentity(selection:CapturedSelection){
    const found=await this.discover(),doc=found.documents.find(item=>this.id(item)===selection.documentId);
    if(!doc)throw new AppError('NATIVE_DOCUMENT_OFFLINE','The captured document is no longer accessible.',409);
    const result=await this.call('selectionIdentity',doc.id,{hostSessionId:selection.hostSessionId});
    if(result?.valid!==true)throw new AppError('SELECTION_SESSION_CHANGED','Captured Office window could not be verified.',409);
  }
  host(doc:NativeDocument):Host{
    const binding:DocumentBinding={documentId:this.id(doc),hostSessionId:doc.sessionId,name:doc.name,kind:doc.kind,capabilities:doc.capabilities,lastSeen:Date.now()};
    return {binding,request:async(method,input:any)=>{
      if(method==='readPptFormat'||method==='writePptFormat'||method==='readPptLayout'||method==='writePptLayout'||method==='readPptShapes'||method==='readPptReplacement'||method==='writePptReplacement'||method==='writePptRichFormat'){
        if(doc.kind!=='powerpoint')throw new AppError('HOST_KIND','PowerPoint is required.');
        return this.call(method,doc.id,input);
      }
      if(method==='readWordFormat'||method==='writeWordFormat'||method==='readWordReplacement'||method==='writeWordReplacement'||method==='readWordTables'||method==='readWordTableSelection'||method==='readWordBatchCell'||method==='readWordTableLayout'||method==='writeWordTableLayout'||method==='readWordParagraphBatch'||method==='writeWordTableRows'){
        if(doc.kind!=='word')throw new AppError('HOST_KIND','Word is required.');
        return this.call(method,doc.id,input);
      }
      if(method==='read'){rangeDimensions(input.range);return this.call('read',doc.id,input);}
      if(['readExcelTableColumns','writeExcelTableColumns'].includes(method)){if(doc.kind!=='excel')throw new AppError('HOST_KIND','Excel is required.');return this.call(method,doc.id,input);}
      if(['readExcelTableCreate','writeExcelTableCreate','removeExcelCreatedTable','readExcelTailProbe','readExcelTablePackage'].includes(method)){if(doc.kind!=='excel')throw new AppError('HOST_KIND','Excel is required.');return this.call(method,doc.id,input);}
      if(['readExcelRangeFormat','writeExcelRangeFormat'].includes(method)){if(doc.kind!=='excel')throw new AppError('HOST_KIND','Excel is required.');return this.call(method,doc.id,input);}
      if(['readExcelChartCreate','writeExcelChartCreate','removeExcelCreatedChart','readExcelCharts','readExcelChart','readExcelChartPackage','readExcelChartFormat','writeExcelChartLayout','readExcelSheets','readExcelTables','readExcelTable','writeExcelTableStyle','readExcelTableAppend','writeExcelTableRows'].includes(method)){
        if(doc.kind!=='excel')throw new AppError('HOST_KIND','Excel is required.');return this.call(method,doc.id,input);
      }
      if(method==='write'){
        const {before,...raw}=input;const edit=validateWrite(raw);const result=await this.call('write',doc.id,{...edit,before});
        if(result.code==='REVISION_CONFLICT')return result;
        if(result.notIssued===true)return result;
        const after:RangeState=result.after;
        const verified=(!edit.values||nativeExcelMatrixMatches(edit.values,after.values))&&(!edit.formulas||nativeExcelMatrixMatches(edit.formulas,after.formulas,true))&&(!edit.numberFormat||canonical(edit.numberFormat)===canonical(after.numberFormat));
        return {...result,verified,revision:revision(after),code:verified?'VERIFIED':'READBACK_MISMATCH',transport:'native-office'};
      }
      if(method==='readText'){
        const result=await this.call('readText',doc.id,hostTextReadSchema.parse(input));
        result.items=await Promise.all((result.items || []).map((item:any)=>textState(item)));assertPageSize(result.items);return result;
      }
      if(method==='writeText'){
        const {onBeforeWrite,...raw}=input;
        const edit=hostTextWriteSchema.parse(raw);
        if(edit.target.kind!==doc.kind)throw new AppError('HOST_KIND','Target belongs to another Office host.');
        const before=await textState(await this.call('readTarget',doc.id,{target:edit.target}));
        if(before.revision!==edit.expectedRevision)return {code:'REVISION_CONFLICT',verified:false,current:before};
        onBeforeWrite?.(before);
        const result=await this.call('writeText',doc.id,{...edit,expectedFingerprint:before.contentHash});
        if(result.code==='REVISION_CONFLICT')return result;
        if(result.notIssued===true)return result;
        const after=await textState(result.after),verified=after.text===edit.text;
        return {before,after,verified,revision:after.revision,code:verified?'VERIFIED':'READBACK_MISMATCH',transport:'native-office',concurrency:'optimistic'};
      }
      if(method==='snapshot'){
        const extension={excel:'xlsx',word:'docx',powerpoint:'pptx'}[doc.kind];const destination=path.join(this.dataRoot,'native-snapshots',`${randomUUID()}.${extension}`);
        await this.call('snapshot',doc.id,{destination});
        const stat=await fs.stat(destination);if(stat.size>32*1024*1024)throw new AppError('SNAPSHOT_LIMIT','Snapshot exceeds 32 MB; saved in the private native-snapshots directory.');
        const bytes=await fs.readFile(destination);return {base64:bytes.toString('base64'),size:bytes.length};
      }
      throw new AppError('UNSUPPORTED_METHOD','Unsupported native Office operation.');
    }};
  }
  async refreshBound(broker:DocumentBroker){
    const result=await this.discover();const live=new Map(result.documents.map(doc=>[this.id(doc),doc]));
    for(const saved of broker.store.documents().filter(d=>d.documentId.startsWith('native:'))){
      const current=broker.hosts.get(saved.documentId),doc=live.get(saved.documentId);
      if(!doc){if(current)broker.detach(current);continue;}
      if(!current||current.binding.hostSessionId!==doc.sessionId||canonical([...current.binding.capabilities].sort())!==canonical([...doc.capabilities].sort())){if(current)broker.detach(current);broker.attach(this.host(doc));}
    }
    return result;
  }
  async stop(){const child=this.child;if(!child)return;await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},1500);child.once('exit',()=>{clearTimeout(timer);resolve();});child.stdin.end();});}
}
