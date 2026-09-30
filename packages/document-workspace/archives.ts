import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {AppError} from '../contracts/index.ts';

export type ArchiveMessage={role:'user'|'assistant'|'tool';text:string};
export type Archive={format:'office-workbench-history/v1';title:string;source:string;messages:ArchiveMessage[];skipped:number};
const MAX_BYTES=8*1024*1024;
function invalid(message:string):never{throw new AppError('INVALID_ARCHIVE',message);}
function publicText(content:unknown):string{
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.map(block=>{
    if(!block||typeof block!=='object')return '';
    if(['text','input_text','output_text'].includes(block.type))return typeof block.text==='string'?block.text:'';
    if(block.type==='tool_use')return JSON.stringify({tool:block.name,input:block.input});
    if(block.type==='tool_result')return publicText(block.content);
    return '';
  }).filter(Boolean).join('\n');
}
export function parseArchive(raw:string,title='Imported history'):Archive{
  if(Buffer.byteLength(raw)>MAX_BYTES)invalid('History exceeds 8 MB.');
  raw=raw.replace(/^\uFEFF/,'');
  let whole:any;
  try{whole=JSON.parse(raw);}catch{}
  const result:Archive={format:'office-workbench-history/v1',title:title.slice(0,160),source:'',messages:[],skipped:0};
  const add=(role:unknown,text:unknown)=>{
    if(!['user','assistant','tool'].includes(String(role))||typeof text!=='string'||!text.trim()){result.skipped++;return;}
    if(text.length>200000||result.messages.length>=10000)invalid('History exceeds message limits; split the export first.');
    result.messages.push({role:role as ArchiveMessage['role'],text});
  };
  if(whole?.format===result.format){
    if(!Array.isArray(whole.messages))invalid('Archive messages must be an array.');
    result.source='workbench';
    if(typeof whole.title==='string')result.title=whole.title.slice(0,160);
    for(const message of whole.messages)add(message?.role,message?.text);
  }else{
    const lines=raw.split(/\r?\n/).filter(line=>line.trim());
    if(lines.length>20000)invalid('Too many history records.');
    let detected='';
    for(const line of lines){
      let record:any;try{record=JSON.parse(line);}catch{invalid('Invalid JSONL record; nothing was imported.');}
      if(record?.type==='response_item'){
        if(detected==='claude-code')invalid('Mixed history formats are not supported.');
        detected='codex';const item=record.payload;
        if(item?.type==='message'&&item.channel!=='analysis')add(item.role,publicText(item.content));
        else if(item?.type==='function_call')add('tool',JSON.stringify({tool:item.name,arguments:item.arguments}));
        else if(item?.type==='function_call_output')add('tool',publicText(item.output));
        else result.skipped++;
      }else if(['user','assistant'].includes(record?.type)&&record.message){
        if(detected==='codex')invalid('Mixed history formats are not supported.');
        detected='claude-code';add(record.message.role,publicText(record.message.content));
      }else result.skipped++;
    }
    result.source=detected;
  }
  if(!result.source||!result.messages.length)invalid('No supported public messages found.');
  return result;
}

export class Archives{
  constructor(private db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS history_archives(id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, count INTEGER NOT NULL, created INTEGER NOT NULL, body TEXT NOT NULL)');}
  import(raw:string,title:string){
    const archive=parseArchive(raw,title),id=createHash('sha256').update(raw).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO history_archives VALUES(?,?,?,?,?,?)').run(id,archive.title,archive.source,archive.messages.length,Date.now(),JSON.stringify(archive));
    return this.info(id);
  }
  list(){return this.db.prepare('SELECT id,title,source,count,created FROM history_archives ORDER BY created DESC LIMIT 200').all();}
  private info(id:string){const row=this.db.prepare('SELECT id,title,source,count,created FROM history_archives WHERE id=?').get(id);if(!row)throw new AppError('NOT_FOUND','History archive not found.',404);return row;}
  read(id:string,offset=0){
    if(!Number.isSafeInteger(offset)||offset<0)invalid('Invalid history offset.');
    const info=this.info(id),archive=this.export(id);
    return {...info,skipped:archive.skipped,items:archive.messages.slice(offset,offset+50),next:offset+50<archive.messages.length?offset+50:null};
  }
  export(id:string):Archive{this.info(id);return JSON.parse(this.db.prepare('SELECT body FROM history_archives WHERE id=?').get(id)!.body as string);}
}
