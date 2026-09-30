import React,{useEffect,useState} from 'react';

export function HistoryArchives({api,upload}:{api:(route:string)=>Promise<any>;upload:(file:File)=>Promise<any>}){
  const [list,setList]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[offset,setOffset]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function run(action:()=>Promise<void>){setError('');setBusy(true);try{await action();}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setBusy(false);}}
  useEffect(()=>{let alive=true;void api('/api/archives').then(rows=>{if(alive)setList(rows);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
  async function read(id:string,start=0){const page=await api(`/api/archives/${id}?offset=${start}`);setSelected(page);setOffset(start);}
  async function download(){
    const data=await api(`/api/archives/${selected.id}/export`),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='workbench-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  return <section className="history-archives" aria-label="历史档案"><h2>历史档案</h2><p>只读保存公开消息，不执行旧工具、不恢复原智能体上下文。支持工作台标准 JSON、Claude Code / Codex JSONL 文本记录；图片与隐藏思考不导入。</p><p>档案可能含敏感信息，保存在本机。导出不会自动脱敏，请勿未经检查公开分享。</p>
    <label className="upload-button">导入历史文件<input aria-label="导入历史文件" type="file" accept=".json,.jsonl" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{if(file.size>8*1024*1024)throw Error('文件不能超过 8 MB。');const saved=await upload(file);setList(await api('/api/archives'));await read(saved.id);});}}/></label>
    {error&&<p role="alert">{error}</p>}<div className="archive-layout"><nav aria-label="档案列表">{list.map(row=><button key={row.id} disabled={busy} aria-pressed={selected?.id===row.id} onClick={()=>void run(()=>read(row.id))}>{row.title}<small>{row.source} · {row.count} 条公开记录</small></button>)}</nav>
    <div>{selected?<><h3>{selected.title}</h3><p>来源：{selected.source} · 跳过 {selected.skipped} 条非公开或不支持的记录</p><button disabled={busy} onClick={()=>void run(download)}>导出档案</button><div aria-label="档案消息">{selected.items.map((m:any,i:number)=><article key={offset+i}><strong>{m.role}</strong><pre>{m.text}</pre></article>)}</div><button disabled={busy||offset===0} onClick={()=>void run(()=>read(selected.id,Math.max(0,offset-50)))}>上一页</button><span>第 {Math.floor(offset/50)+1} 页</span><button disabled={busy||selected.next===null} onClick={()=>void run(()=>read(selected.id,selected.next))}>下一页</button></>:<p>选择档案，或导入已有聊天记录。</p>}</div></div>
  </section>;
}
