import React,{useState,useEffect} from 'react';
import type {Api,FileRecord,FileOpenIntent} from './Product.tsx';
export function TaskFiles({conversation,revision,busy,api,download,open}:{conversation:string;revision:number;busy:boolean;api:Api;download:(f:FileRecord)=>Promise<void>;open:(file:FileRecord,action:FileOpenIntent['action'])=>void}){
  const [files,setFiles]=useState<FileRecord[]>([]),[error,setError]=useState(''),[listedConversation,setListedConversation]=useState('');
  useEffect(()=>{setFiles([]);},[conversation]);
  useEffect(()=>{
    let alive=true;setError('');
    if(!conversation){setFiles([]);return;}
    void api(`/api/files?conversation=${encodeURIComponent(conversation)}`).then(value=>{if(alive){setFiles(value);setListedConversation(conversation);}}).catch(()=>{if(alive)setError('文件列表暂时不可用，请到文件库刷新。');});
    return()=>{alive=false;};
  },[conversation,revision,busy,api]);
  if((listedConversation!==conversation||!files.length)&&!error)return null;
  return <details className="task-files"><summary>任务文件 · {listedConversation===conversation?files.length:0}</summary>{error&&<p role="alert">{error}</p>}<div>{listedConversation===conversation&&files.map(f=><article className="task-file-card" key={f.id} data-file-id={f.id}><button title={`下载 ${f.name} · ${f.id}`} onClick={()=>{void download(f).catch(()=>setError('下载失败，请检查工作台连接。'));}}><span>{f.extension.toUpperCase()}{f.version?` · v${f.version}`:''}</span><strong>{f.name}</strong><small>{f.sourceId?'编辑副本':'附件 / 新文件'} · {f.id.slice(0,8)} ↓</small></button><div className="actions">{['docx','xlsx','pptx','pdf','txt','md','csv','tsv'].includes(f.extension)&&<button disabled={busy} onClick={()=>open(f,'inspect')}>检查此版本</button>}{['docx','xlsx','pptx','png','jpg','jpeg'].includes(f.extension)&&<button disabled={busy} onClick={()=>open(f,'preview')}>预览此版本</button>}{['docx','xlsx','pptx'].includes(f.extension)&&<button disabled={busy} onClick={()=>open(f,'validate')}>验证此版本</button>}</div></article>)}</div></details>;
}
