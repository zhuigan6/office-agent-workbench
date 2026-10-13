import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { AppError } from '../contracts/index.ts';
import { Store } from './store.ts';
import { OfficeCli } from '../officecli-adapter/index.ts';
import {readPdf} from './pdf.ts';
import {assetProperty,inlineTableCsv} from './assets.ts';
import {packageChanges} from './changes.ts';
import {selectedHelp} from '../contracts/file-help.ts';
import {importOptions} from './import-options.ts';
import {assertLiteralCsv} from './csv-safety.ts';
import {boundedInspection} from '../contracts/inspection-output.ts';
import {batchEvidence,FileBatchError} from '../contracts/file-batch.ts';

const mime:Record<string,string>={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',tsv:'text/tab-separated-values'};
const officeKinds=['docx','xlsx','pptx'];
export interface FileRecord {id:string;name:string;extension:string;mediaType:string;size:number;sha256:string;createdAt:number;sourceId?:string;version?:number;rootId?:string}
export function validateFile(name:string,bytes:Buffer) {
  if(!name||name.length>200||/[\\/\x00-\x1f]/.test(name))throw new AppError('INVALID_FILENAME','Use a file name, not a path.');
  const ext=path.extname(name).slice(1).toLowerCase();
  if(!mime[ext]||!bytes.length||bytes.length>32*1024*1024)throw new AppError('FILE_LIMIT','Supported: docx/xlsx/pptx, PNG/JPEG, PDF, text/Markdown/CSV/TSV; maximum 32 MB.');
  if(officeKinds.includes(ext)){
    const required:Record<string,string>={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml'};
    let expanded=0,count=0;const names=new Set<string>();
    try{unzipSync(bytes,{filter:entry=>{
      names.add(entry.name);expanded+=entry.originalSize;count++;
      if(expanded>128*1024*1024||count>10000||entry.originalSize>32*1024*1024)throw new Error('Archive exceeds expansion limit');
      if(entry.name.includes('..')||/^[/\\]|^[a-z]:/i.test(entry.name)||/vbaProject\.bin$/i.test(entry.name))throw new Error('Unsafe or macro-enabled archive');
      return false;
    }});}catch{throw new AppError('INVALID_OFFICE_FILE','Invalid, unsafe, macro-enabled or oversized Office archive.');}
    if(!names.has('[Content_Types].xml')||!names.has(required[ext]))throw new AppError('INVALID_OFFICE_FILE','File content does not match its Office extension.');
  }
  if(ext==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new AppError('INVALID_IMAGE','Invalid PNG signature.');
  if(['jpg','jpeg'].includes(ext)&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw new AppError('INVALID_IMAGE','Invalid JPEG signature.');
  if(ext==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw new AppError('INVALID_PDF','Invalid PDF signature.');
  return ext;
}

const batchVerbs=new Set(['add','set','remove','move','swap','get','query','raw','raw-set','add-part','dump']);
export function validateBatch(commands:unknown):Record<string,any>[] {
  if(!Array.isArray(commands)||!commands.length||commands.length>500||JSON.stringify(commands).length>512000)throw new AppError('BATCH_LIMIT','Provide 1 to 500 structured commands, at most 512 KB.');
  const keys=new Set(['command','path','parent','type','props','to','after','before','path2','selector','part','xpath','value','depth','limit','index']);
  for(const item of commands){
    if(item?.command==='meta'){
      if(item!==commands[0]||item.dumpVersion!==1||Object.keys(item).some(key=>!['command','dumpVersion'].includes(key)))throw new AppError('DUMP_VERSION','Only the documented dumpVersion 1 marker is accepted, as the first command.');
      continue;
    }
    if(!item||typeof item!=='object'||Array.isArray(item)||!batchVerbs.has(item.command))throw new AppError('COMMAND_REJECTED','Only document edit/query commands are supported in a batch.');
    if(Object.keys(item).some(k=>!keys.has(k)))throw new AppError('ARGUMENT_REJECTED','Unsupported batch field. Discover syntax with office_file help.');
    if(item.props&&(typeof item.props!=='object'||Array.isArray(item.props)))throw new AppError('INVALID_PROPERTIES','Properties must be an object.');
    for(const [key,value] of Object.entries(item.props || {})){
      if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new AppError('INVALID_PROPERTIES','Property values must be scalar.');
      assetProperty(key,value);
    }
    for(const key of ['path','parent','to','after','before','path2','part']){
      const value=item[key];if(value!==undefined&&(typeof value!=='string'||/^[a-z]:|\\|(^|\/)\.\.(\/|$)|^(file|https?):/i.test(value)))throw new AppError('PATH_REJECTED','Use document element paths, not filesystem paths.');
    }
  }
  return commands;
}

export class FileWorkspace {
  constructor(public store:Store,public root:string,public engine:OfficeCli){
    store.db.exec('CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS conversation_files(conversation TEXT NOT NULL,file TEXT NOT NULL,PRIMARY KEY(conversation,file));');
  }
  list(conversation?:string):FileRecord[]{
    const rows=conversation?this.store.db.prepare('SELECT f.body FROM files f JOIN conversation_files c ON f.id=c.file WHERE c.conversation=? ORDER BY f.rowid DESC').all(conversation):this.store.db.prepare('SELECT body FROM files ORDER BY rowid DESC').all();
    return rows.map((r:any)=>JSON.parse(r.body));
  }
  get(id:string):FileRecord{const row=this.store.db.prepare('SELECT body FROM files WHERE id=?').get(id) as any;if(!row)throw new AppError('FILE_NOT_FOUND','File not found.',404);return JSON.parse(row.body);}
  filename(id:string){const f=this.get(id);return path.join(this.root,`${f.id}.${f.extension}`);}
  attach(conversation:string,id:string){this.get(id);this.store.db.prepare('INSERT OR IGNORE INTO conversation_files VALUES(?,?)').run(conversation,id);}
  requireAccess(conversation:string,id:string){if(!this.store.db.prepare('SELECT 1 FROM conversation_files WHERE conversation=? AND file=?').get(conversation,id))throw new AppError('FILE_SCOPE','File is not attached to this conversation.',403);return this.get(id);}
  async put(name:string,bytes:Buffer,sourceId?:string):Promise<FileRecord>{
    const extension=validateFile(name,bytes);await fs.mkdir(this.root,{recursive:true});
    const source=sourceId?this.get(sourceId):undefined;
    const file:FileRecord={id:randomUUID(),name,extension,mediaType:mime[extension],size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),createdAt:Date.now(),version:source?(source.version || 1)+1:1,...(source?{sourceId,rootId:source.rootId || source.id}:{})};
    await fs.writeFile(path.join(this.root,`${file.id}.${extension}`),bytes,{flag:'wx'});
    this.store.db.prepare('INSERT INTO files VALUES(?,?)').run(file.id,JSON.stringify(file));this.store.event('file.created',file);return file;
  }
  async checkedFile(id:string){const record=this.get(id),name=this.filename(id);const bytes=await fs.readFile(name);if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new AppError('FILE_CHANGED','Stored file changed outside the workbench. Import it as a new version.',409);return name;}
  async command(request:any,scope?:string):Promise<any>{
    const action=request.action;
    if(action==='list')return {files:this.list(scope)};
    if(action==='help'){
      const args=[request.format,...(Array.isArray(request.args)?request.args:[])].filter(Boolean);
      if(args.length>4||args.some(v=>typeof v!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(v)))throw new AppError('HELP_ARGUMENT','Use a format and optional element or verb.');
      const result=await this.engine.help(args);if(result.code!==0)throw new AppError('HELP_FAILED',(result.stderr||result.stdout).slice(0,1500));return selectedHelp(result.stdout,request.fields);
    }
    if(action==='create')return this.mutate(request,scope);
    const file=scope?this.requireAccess(scope,request.fileId):this.get(request.fileId);
    const filename=await this.checkedFile(file.id);
    if(file.extension==='pdf'&&action==='inspect'){
      if(request.command&&!['view','text'].includes(request.command))throw new AppError('PDF_COMMAND','PDF supports text inspection with --start/--end page numbers.');
      return {file,output:await readPdf(filename,request.args)};
    }
    if(!officeKinds.includes(file.extension)){
      if(action!=='inspect'||!['txt','md','csv','tsv'].includes(file.extension))throw new AppError('FILE_TYPE','Use an image-capable agent for images/PDF; OfficeCLI handles docx/xlsx/pptx.');
      const text=await fs.readFile(filename,'utf8');return {file,output:text.slice(0,24000),truncated:text.length>24000};
    }
    if(action==='batch'||action==='merge'||action==='import')return this.mutate(request,scope);
    if(action==='preview'){
      const result=await this.engine.run(['view',filename,'html']);
      if(result.code!==0)throw new AppError('PREVIEW_FAILED','OfficeCLI could not preview this file.',422);
      const policy="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
      return {file,output:`<meta http-equiv="Content-Security-Policy" content="${policy}">`+result.stdout,previewKind:'html-not-native-office'};
    }
    if(action!=='inspect')throw new AppError('INVALID_ACTION','Use list, help, create, inspect, batch, merge or preview.');
    const command=request.command || 'view';
    if(!['view','get','query','validate','raw','dump'].includes(command))throw new AppError('COMMAND_REJECTED','Unsupported inspection command.');
    const args=request.args || (command==='view'?['outline']:[]);
    if(!Array.isArray(args)||args.length>12||args.some((a:any)=>typeof a!=='string'||a.length>4000))throw new AppError('ARGUMENT_LIMIT','Invalid command arguments.');
    const flags=new Set(['--start','--end','--max-lines','--limit','--depth','--range','--cols','--type','--page']);
    if(args.some((a:string)=>a.startsWith('-')&&!flags.has(a)))throw new AppError('FLAG_REJECTED','Output paths, browser launch and runtime options are not allowed.');
    if(command==='view'&&!['text','outline','stats','issues','annotated','forms'].includes(args[0]))throw new AppError('VIEW_REJECTED','Use the separate preview action for visual output.');
    const result=await this.engine.run([command,filename,...args,'--json']);
    if(result.code!==0)throw new AppError('ENGINE_FAILED',(result.stderr||result.stdout).slice(0,2000),422);
    let output:any;try{output=JSON.parse(result.stdout);}catch{output=result.stdout;}
    return {file,...boundedInspection(output)};
  }
  async mutate(request:any,scope?:string){
    if(typeof request.operationId!=='string'||!/^[\w-]{1,100}$/.test(request.operationId))throw new AppError('OPERATION_REQUIRED','Supply a unique operationId for creation or edits.');
    if(request.action==='create'&&(!officeKinds.includes(request.format)||request.fileId))throw new AppError('FORMAT_REJECTED','Create a new docx, xlsx or pptx without a source fileId.');
    const extension=request.action==='create'?request.format:this.get(request.fileId).extension;
    if(request.action==='import'){
      importOptions(request);
      const dataFile=scope?this.requireAccess(scope,request.dataFileId):this.get(request.dataFileId);
      if(extension!=='xlsx'||!['csv','tsv'].includes(dataFile.extension))throw new AppError('IMPORT_TYPE','Import requires an xlsx target and an uploaded CSV/TSV source.');
      assertLiteralCsv(await fs.readFile(await this.checkedFile(dataFile.id)),request.delimiter??(dataFile.extension==='tsv'?'\t':','));
    }
    if(request.action==='merge'){
      const data=request.data;
      if(!data||typeof data!=='object'||Array.isArray(data)||!Object.keys(data).length||Object.keys(data).length>200||JSON.stringify(data).length>64000||Object.entries(data).some(([key,value])=>key.length>200||(value!==null&&!['string','number','boolean'].includes(typeof value)))||request.commands!==undefined)throw new AppError('MERGE_DATA','Template merge needs 1 to 200 scalar JSON fields, at most 64,000 characters; no batch commands or data file paths.');
    }
    if(request.commands)validateBatch(request.commands);
    const id=scope?`${scope}_${request.operationId}`:request.operationId;
    const started=this.store.begin(id,request.fileId || 'new-file',`file.${request.action}`,request);
    if(!started.fresh){if(started.operation.status==='applied')return started.operation.result;const saved=started.operation.result as any;if(saved?.receipt)throw new FileBatchError({...saved.receipt,replayed:false},'OPERATION_STATE',409);throw new AppError('OPERATION_STATE',`Operation is ${started.operation.status}; inspect its existing result before retrying.`,409);}
    const temporary=path.join(this.root,`working-${randomUUID()}.${extension}`);
    const mergeData=temporary+'.merge.json';
    let execution:any;
    try{
      this.store.updateOperation(id,'running',null);await fs.mkdir(this.root,{recursive:true});
      if(request.action==='create'){
        if(!officeKinds.includes(request.format))throw new AppError('FORMAT_REJECTED','Choose docx, xlsx or pptx.');
        const created=await this.engine.run(['create',temporary,'--json']);if(created.code!==0)throw new AppError('ENGINE_FAILED',created.stderr||created.stdout,422);
      } else if(request.action==='merge'){
        await fs.writeFile(mergeData,JSON.stringify(request.data),{flag:'wx'});
        const merged=await this.engine.run(['merge',await this.checkedFile(request.fileId),temporary,'--data',mergeData,'--json']);
        if(merged.code!==0)throw new AppError('MERGE_FAILED','OfficeCLI could not merge this template.',422);
        try{if(JSON.parse(merged.stdout).success===false)throw Error();}catch{throw new AppError('MERGE_FAILED','OfficeCLI did not confirm template merge.',422);}
      } else await fs.copyFile(await this.checkedFile(request.fileId),temporary,fs.constants.COPYFILE_EXCL);
      let output:any={success:true};
      if(request.action==='import'){
        const imported=await this.engine.run(['import',temporary,request.sheet,await this.checkedFile(request.dataFileId),...importOptions(request),'--json']);
        try{output=JSON.parse(imported.stdout);}catch{throw new AppError('IMPORT_FAILED','OfficeCLI did not return an import result.',422);}
        if(imported.code!==0||output.success===false)throw new AppError('IMPORT_FAILED','OfficeCLI could not import this data.',422);
      }
      if(request.commands){
        const commands=structuredClone(validateBatch(request.commands));
        for(const item of commands)for(const [key,value] of Object.entries(item.props || {})){
          const asset=assetProperty(key,value);if(!asset){
            // Table data accepts FileSource paths upstream. Force inline CSV
            // into a data URI so a coincidental local filename cannot be read.
            if(key.toLowerCase()==='data'&&item.type==='table'&&typeof value==='string')item.props[key]=inlineTableCsv(value);
            continue;
          }
          if(scope)this.requireAccess(scope,asset.id);item.props[key]=asset.prefix+await this.checkedFile(asset.id);
        }
        const batch=await this.engine.run(['batch',temporary,'--json'],JSON.stringify(commands));
        execution={exitCode:batch.code,commands:commands.map(item=>item.command)};
        try{output=JSON.parse(batch.stdout);}catch{execution.responseFormat='non-json';execution.rawOutput=batch.stdout;execution.stderr=batch.stderr;throw new AppError('ENGINE_RESPONSE','OfficeCLI did not return a batch result.',502);}
        execution.output=output;
        if(batch.code!==0||output.success===false||output.data?.summary?.failed>0||(Array.isArray(output.data?.results)&&output.data.results.some((row:any)=>row.success===false)))throw new FileBatchError({operationId:id,status:'failed',copyPublished:false,...(batchEvidence(execution)?{batch:batchEvidence(execution)}:{})});
      }else if(request.action==='batch')throw new AppError('BATCH_REQUIRED','Provide structured batch commands.');
      const validation=await this.engine.run(['validate',temporary,'--json']);
      let validated:any;try{validated=JSON.parse(validation.stdout);}catch{validated={raw:validation.stdout};}
      const original=request.fileId?this.get(request.fileId):undefined;
      const base=original?this.get(original.rootId || original.id):undefined;
      const name=base?base.name.replace(/\.[^.]+$/,`-v${(original!.version || 1)+1}.${base.extension}`):`new-document.${request.format}`;
      const bytes=await fs.readFile(temporary);
      const changes=packageChanges(original?await fs.readFile(await this.checkedFile(original.id)):undefined,bytes);
      const file=await this.put(name,bytes,original?.id);if(scope)this.attach(scope,file.id);
      const result={file,output,changes,...(execution?{execution,batch:batchEvidence(execution)}:{}),validation:{exitCode:validation.code,result:validated},status:validation.code===0?'created':'created-with-validation-issues'};
      this.store.updateOperation(id,'applied',result);return result;
    }catch(error){this.store.updateOperation(id,'failed',{message:error instanceof Error?error.message:String(error),...(execution?{execution}:{}),...(error instanceof FileBatchError?{receipt:error.receipt}:{})});throw error;}
    finally {await fs.unlink(temporary).catch(()=>{});if(request.action==='merge')await fs.unlink(mergeData).catch(()=>{});}
  }
}
