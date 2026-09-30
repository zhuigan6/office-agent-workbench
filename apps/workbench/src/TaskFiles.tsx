import React,{useState,useEffect} from 'react';
import type {Api,FileRecord} from './Product.tsx';
export function TaskFiles({conversation,revision,busy,api,download}:{conversation:string;revision:number;busy:boolean;api:Api;download:(f:FileRecord)=>Promise<void>}){
  const [files,setFiles]=useState<FileRecord[]>([]),[error,setError]=useState('');
  useEffect(()=>{setFiles([]);},[conversation]);
  useEffect(()=>{
    let alive=true;setError('');
    if(!conversation){setFiles([]);return;}
    void api(`/api/files?conversation=${encodeURIComponent(conversation)}`).then(value=>{if(alive)setFiles(value);}).catch(()=>{if(alive)setError('文件列表暂时不可用，请到文件库刷新。');});
    return()=>{alive=false;};
  },[conversation,revision,busy,api]);
  if(!files.length&&!error)return null;
  return <details className="task-files"><summary>任务文件 · {files.length}</summary>{error&&<p role="alert">{error}</p>}<div>{files.map(f=><button key={f.id} title={`下载 ${f.name} · ${f.id}`} onClick={()=>{void download(f).catch(()=>setError('下载失败，请检查工作台连接。'));}}><span>{f.extension.toUpperCase()}{f.version?` · v${f.version}`:''}</span><strong>{f.name}</strong><small>{f.sourceId?'编辑副本':'附件 / 新文件'} · {f.id.slice(0,8)} ↓</small></button>)}</div></details>;
}
