import React,{useEffect,useState} from 'react';
import type {Api} from './Product.tsx';

export function NativeDocuments({api,onConnect}:{api:Api;onConnect:(binding:any)=>Promise<void>}){
  const [items,setItems]=useState<any[]>([]),[pending,setPending]=useState(false),[error,setError]=useState(''),[diagnostics,setDiagnostics]=useState<any[]>([]);
  async function discover(){setPending(true);setError('');try{const result=await api('/api/native/documents');setItems(result.documents || []);setDiagnostics((result.diagnostics || []).filter((d:any)=>!d.message?.includes('MK_E_UNAVAILABLE')));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}}
  useEffect(()=>{void discover();},[]);
  return <section className="product-page"><div className="panel-heading"><div><h2>打开的 Office 文档</h2><p>外置连接，不安装 Office 加载项。</p></div><button disabled={pending} onClick={()=>void discover()}>{pending?'检测中…':'刷新'}</button></div>
    <p className="notice">只连接你选中的文档，不自动启动 Office，不自动保存，也不运行宏。当前 Windows 用户会话中的桌面 Word、Excel 和 PowerPoint 可用于实时操作。</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {!pending&&!items.length&&<div className="empty-state"><h3>尚未发现打开的文档</h3><p>请正常打开一份 Office 文档，再点击刷新。Office 与工作台需使用同一用户权限。其他实例的文档暂未发现时，可先使用文件库处理副本。</p></div>}
    <div className="native-list">{items.map(item=><article className="native-card" key={item.id}><span className="extension">{item.kind}</span><div><h3>{item.name}</h3><p>{item.saved?'已保存':'含未保存修改'} · {item.capabilities.includes('write')||item.capabilities.includes('writeText')?'可请求编辑':'只读'}{item.processId?` · 进程 ${item.processId}`:''}</p><details><summary>文档位置和能力</summary><p>{item.location}</p><small>{item.capabilities.join(' / ')}</small></details></div><button disabled={pending} onClick={async()=>{setPending(true);setError('');try{const binding=await api('/api/native/bind',{id:item.id});await onConnect(binding);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}}}>连接并建任务</button></article>)}</div>
    <p className="muted">Word 的完整文件快照需要先保存；在线正文读取包含未保存内容。Excel/PPT 快照复制到私有工作区，不覆盖原件。实时编辑采用乐观冲突检查，不等同于 Office 原生事务或任意格式的无损转换。</p>
    {diagnostics.length>0&&<details className="advanced"><summary>连接诊断</summary>{diagnostics.map((d,i)=><p key={i}>{d.kind}: {d.message}</p>)}</details>}
  </section>;
}
