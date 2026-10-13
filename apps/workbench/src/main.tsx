import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TaskDialog, FileLibrary, Settings, type Catalog, type FileRecord,type FileOpenIntent } from './Product.tsx';
import {NativeDocuments} from './NativeDocuments.tsx';
import {SelectionPreview} from './SelectionPreview.tsx';
import {readDrafts,draftKey,emptyDraft,acknowledgeDraft,type Draft} from './drafts.ts';
import {sendIntent,acknowledgeIntent} from './send-intent.ts';
import {HistoryWindow} from './history.ts';
import {RuntimePanel} from './RuntimePanel.tsx';
import {QuestionCard} from './QuestionCard.tsx';
import {TaskFiles} from './TaskFiles.tsx';
import {HistoryArchives} from './Archives.tsx';
import {NativeSessions} from './NativeSessions.tsx';
import {messageText} from './message-text.ts';
import {ApprovalDetails} from './ApprovalDetails.tsx';
import './style.css';

const supplied=new URLSearchParams(location.hash.slice(1)).get('token');
if(supplied){localStorage.setItem('workbench.token',supplied);history.replaceState(null,'',location.pathname+location.search);}
let token=localStorage.getItem('workbench.token') || '';
async function api(route:string,data?:unknown){
  const res=await fetch(route,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await res.json();if(!res.ok)throw Object.assign(new Error(body.message || '请求失败'),body.operation?{operation:body.operation}:{});return body;
}
const labels:Record<string,string>={queued:'排队中',running:'执行中',applied:'已验证',conflict:'有冲突',failed:'失败',unknown:'结果待确认'};
async function downloadFile(file:Pick<FileRecord,'id'|'name'>){const response=await fetch(`/api/files/${file.id}/download`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('下载失败');const object=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=object;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(object),5000);}
async function previewImage(file:FileRecord){
  if(!['png','jpg','jpeg'].includes(file.extension))throw Error('只支持 PNG/JPEG 图片预览。');
  const response=await fetch(`/api/files/${encodeURIComponent(file.id)}/download`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw Error('图片读取失败。');
  return URL.createObjectURL(new Blob([await response.arrayBuffer()],{type:file.extension==='png'?'image/png':'image/jpeg'}));
}
async function uploadFiles(files:File[],conversation?:string):Promise<FileRecord[]>{
  if(files.length>10)throw new Error('一次最多上传十份文件。');const uploaded:FileRecord[]=[];
  for(const file of files){if(file.size>32*1024*1024)throw new Error('单份文件不能超过 32 MB。');const query=new URLSearchParams({name:file.name});if(conversation)query.set('conversation',conversation);
    const response=await fetch('/api/files?'+query,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.message);uploaded.push(result);}
  return uploaded;
}
function Message({message:m}:{message:any}){
  const text=messageText(m);if(!text)return null;
  if(m.type==='thinking')return <details className="thinking-record"><summary>思考过程</summary><p>{text}</p></details>;
  if(m.type==='tool_call')return <details className="tool-record"><summary>{m.content?.name || '工具调用'} · {m.content?.status==='completed'?'已返回':m.content?.status || '执行中'}</summary><pre>{JSON.stringify(m.content,null,2)}</pre></details>;
  const user=m.role==='user'||m.position==='right';
  return <article className={'message '+(user?'user':'assistant')}><div className="message-label">{user?'你':'智能体'}</div><div className={'message-text '+(user?'':'markdown')}>{user?text:<Markdown remarkPlugins={[remarkGfm]} components={{a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,img:({src,alt})=><a href={src} target="_blank" rel="noopener noreferrer">{alt || '图片链接（不自动加载）'}</a>}}>{text}</Markdown>}</div></article>;
}
function App(){
  const [paired,setPaired]=useState(Boolean(token)),[pairInput,setPairInput]=useState('');
  const [status,setStatus]=useState<any>(null),[conversations,setConversations]=useState<any[]>([]),[active,setActive]=useState(new URLSearchParams(location.search).get('conversation') || localStorage.getItem('workbench.conversation') || '');
  const [messages,setMessages]=useState<any[]>([]),[operations,setOperations]=useState<any[]>([]),[confirmations,setConfirmations]=useState<any[]>([]);
  const [drafts,setDrafts]=useState(()=>readDrafts(sessionStorage));
  const [selectionRefs,setSelectionRefs]=useState<Record<string,string|undefined>>({});
  const {content,attachments}=drafts[active] || emptyDraft();
  function updateDraft(change:(draft:Draft)=>Draft){const id=active;setDrafts(old=>({...old,[id]:change(old[id] || emptyDraft())}));}
  const setContent=(content:string)=>updateDraft(draft=>({...draft,content}));
  const setAttachments=(value:FileRecord[]|((old:FileRecord[])=>FileRecord[]))=>updateDraft(draft=>({...draft,attachments:typeof value==='function'?value(draft.attachments):value}));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[stream,setStream]=useState('');
  const sending=useRef(new Set<string>());
  const preserveScroll=useRef(false);
  const [fileOpen,setFileOpen]=useState<FileOpenIntent|null>(null);
  useEffect(()=>setFileOpen(null),[active]);
  useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify(drafts));}catch{setError('草稿暂时无法保存到浏览器；请保持窗口打开。');}},[drafts]);
  const [socketOnline,setSocketOnline]=useState(false);
  const [documentId,setDocumentId]=useState(''),[sheet,setSheet]=useState('Sheet1'),[range,setRange]=useState('A1:D12'),[preview,setPreview]=useState<any>(null),[artifact,setArtifact]=useState('');
  const [nav,setNav]=useState(false),[documentPanel,setDocumentPanel]=useState(false);
  const [view,setView]=useState<'chat'|'files'|'documents'|'settings'|'archives'|'native'>('chat'),[newTask,setNewTask]=useState(false),[catalog,setCatalog]=useState<Catalog>({agents:[],providers:[]});
  const [fileRevision,setFileRevision]=useState(0),[uploading,setUploading]=useState(false);
  const [hasOlder,setHasOlder]=useState(false),[loadingOlder,setLoadingOlder]=useState(false);
  const historyWindow=useRef(new HistoryWindow());
  historyWindow.current.select(active);
  const socket=useRef<WebSocket|null>(null),activeRef=useRef(active),lastMessage=useRef<HTMLDivElement|null>(null);
  activeRef.current=active;
  const guard=async(action:()=>Promise<void>)=>{setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}};
  async function refresh(){
    const [state,list,ops]=await Promise.all([api('/api/status'),api('/api/conversations'),api('/api/operations')]);
    setStatus(state);setConversations(list);setOperations(ops);
    const currentConversation=list.find((c:any)=>c.id===activeRef.current);
    if(currentConversation)setBusy(Boolean(currentConversation.turn)||sending.current.has(currentConversation.id));
  }
  async function refreshConversation(id:string){
    if(activeRef.current!==id)return;
    const ticket=historyWindow.current.begin()!;
    const [history,approvals,state]=await Promise.all([api(`/api/conversations/${id}/messages`),api(`/api/conversations/${id}/confirmations`),api(`/api/conversations/${id}/state`)]);
    if(activeRef.current!==id)return;
    const items=Array.isArray(history)?history:history.items || history.messages || [];
    if(!historyWindow.current.apply(ticket,history))return;
    setBusy(Boolean(state.runtime?.is_processing || state.runtime?.turn_id)||sending.current.has(id));
    setHasOlder(historyWindow.current.hasOlder);
    setMessages(historyWindow.current.items);
    const pending=Array.isArray(approvals)?approvals:approvals.items || approvals.confirmations || [];
    setConfirmations(pending.map((c:any)=>{
      const tool=items.find((m:any)=>m.type==='tool_call'&&[c.call_id,`aionrs-${c.call_id}`].includes(m.content?.call_id));
      return {...c,msg_id:c.msg_id || tool?.msg_id};
    }));
  }

  async function loadOlder(){
    const id=active,ticket=historyWindow.current.begin(true);if(!ticket)return;
    setLoadingOlder(true);
    try{
      const page=await api(`/api/conversations/${id}/messages?before=${encodeURIComponent(ticket.cursor)}`);
      if(historyWindow.current.apply(ticket,page)){
        preserveScroll.current=true;
        setMessages(historyWindow.current.items);setHasOlder(historyWindow.current.hasOlder);
      }
    }finally{historyWindow.current.fail(ticket);if(activeRef.current===id)setLoadingOlder(false);}
  }
  async function reloadCatalog(){setCatalog(await api('/api/agents'));}
  useEffect(()=>{if(paired&&status?.coreReady)void guard(reloadCatalog);},[paired,status?.coreReady]);
  useEffect(()=>{
    if(!paired)return;let stopped=false,timer:ReturnType<typeof setTimeout>;
    const connect=()=>{
      const ws=new WebSocket(location.origin.replace('https:','wss:')+'/ws',['workbench',token]);socket.current=ws;
      ws.onopen=()=>{setSocketOnline(true);};
      ws.onmessage=async({data})=>{
        const msg=JSON.parse(data);
        if(msg.type==='error')setError(msg.message);
        if(msg.type==='files.changed')setFileRevision(value=>value+1);
        if(msg.type==='core.event'){
          const event=msg.event;
          if(event.data?.conversation_id===activeRef.current){
            if(event.name==='message.stream'&&event.data.type==='content'&&typeof event.data.data?.content==='string')setStream(s=>s+event.data.data.content);
            if(event.name==='turn.completed'){setBusy(false);setStream('');void guard(()=>refreshConversation(activeRef.current));}
            if(event.name?.includes('error'))setError(String(event.data.message || event.data.error || '模型执行失败'));
          }
        }
      };
      ws.onclose=()=>{setSocketOnline(false);if(!stopped)timer=setTimeout(connect,2000);};
      ws.onerror=()=>{};
    };connect();return()=>{stopped=true;clearTimeout(timer);socket.current?.close();};
  },[paired]);
  useEffect(()=>{if(!paired)return;let alive=true;const tick=async()=>{if(alive)await guard(refresh);};void tick();const interval=setInterval(tick,2500);return()=>{alive=false;clearInterval(interval);};},[paired]);
  useEffect(()=>{
    setMessages([]);setHasOlder(false);setLoadingOlder(false);setBusy(sending.current.has(active));setStream('');setConfirmations([]);setPreview(null);setArtifact('');
    if(!active||!paired)return;localStorage.setItem('workbench.conversation',active);
    const tick=()=>guard(()=>refreshConversation(active));void tick();const interval=setInterval(tick,1800);return()=>clearInterval(interval);
  },[active,paired]);
  useEffect(()=>{if(preserveScroll.current){preserveScroll.current=false;return;}lastMessage.current?.scrollIntoView({block:'nearest'});},[messages.length,stream]);
  const activeConversation=conversations.find(c=>c.id===active);
  const selectedDoc=activeConversation?activeConversation.documentId:documentId;
  const doc=status?.documents.find((d:any)=>d.documentId===selectedDoc);
  async function createConversation(){await reloadCatalog();setNewTask(true);setNav(false);}
  async function send(){
    if((!content.trim()&&!attachments.length)||!active||busy||uploading||sending.current.has(active))return;
    const id=active,submitted={content,attachments};sending.current.add(id);setBusy(true);setStream('');
    try{
      const selectionId=selectionRefs[id];
      const payload={content:content || '请分析所附文件。',files:attachments.map(f=>f.id),...(selectionId?{selectionId}:{})};
      const requestId=sendIntent(sessionStorage,id,payload);
      await api(`/api/conversations/${id}/messages`,{...payload,requestId});
      acknowledgeIntent(sessionStorage,id,requestId);
      setSelectionRefs(old=>old[id]===selectionId?{...old,[id]:undefined}:old);
      setDrafts(old=>({...old,[id]:acknowledgeDraft(old[id] || emptyDraft(),submitted)}));
      await refreshConversation(id);
    }catch(e){if(activeRef.current===id)setBusy(false);throw e;}
    finally{sending.current.delete(id);}
  }
  function openWindow(){const target=new URL(location.origin);if(active)target.searchParams.set('conversation',active);target.hash='token='+encodeURIComponent(token);window.open(target.toString(),'_blank','noopener');}
  async function download(){await downloadFile({id:artifact,name:`snapshot.${doc?.kind==='word'?'docx':doc?.kind==='powerpoint'?'pptx':'xlsx'}`});}
  if(!paired)return <main className="pair"><div className="monogram">O/W</div><h1>连接你的工作台</h1><p>请使用本地启动器打开，或输入本机配对凭据。</p><input type="password" aria-label="配对凭据" value={pairInput} onChange={e=>setPairInput(e.target.value)}/><button onClick={()=>{token=pairInput.trim();localStorage.setItem('workbench.token',token);setPaired(true);}}>连接</button></main>;
  return <div className={'shell '+(nav?'nav-open':'')}>
    <aside className="rail"><div className="brand"><span className="monogram">O/W</span><div>Office Workbench<small>文档 · 对话 · 行动</small></div></div><button className="new" disabled={!status?.coreReady} onClick={()=>guard(createConversation)}>＋ 新建任务</button><div className="section-label">最近任务</div><nav>{conversations.map(c=><button key={c.id} className={active===c.id?'selected':''} onClick={()=>{setActive(c.id);setView('chat');setNav(false);}}><span>{c.name}</span><small>{c.model || c.id}</small></button>)}</nav><div className="rail-note">同一任务，随处接续。<br/>文档操作保留可核对的记录。</div><div className="version">LOCAL DEVELOPMENT · 0.1 ALPHA</div></aside>
    <main className="workspace"><header><button className="menu subtle" aria-label="任务列表" onClick={()=>setNav(!nav)}>☰</button><div className="heading"><span className="eyebrow">YOUR OFFICE, CONNECTED</span><h1>{view==='native'?'原生智能体会话':activeConversation?.name || '从这份文档开始'}</h1></div><button className="subtle" onClick={openWindow} title="在独立窗口接续">独立窗口 ↗</button></header>
      <div className="connection"><span className={'dot '+(status?.coreReady&&socketOnline?'online':'')}/><span>{status?.coreReady?(view==='native'?'工作台后台已就绪':'智能体已就绪'):'正在连接智能体'}</span><span className="connection-model" title={view==='native'?'本机 Codex 原生配置':activeConversation?.model || status?.model}>{view==='native'?'Codex · 本机原生配置':<>{activeConversation?.source==='native'?'本机智能体配置':catalog.providers.find(p=>p.id===activeConversation?.providerId)?.name || status?.provider || '…'} · {activeConversation?.model || status?.model || '…'}</>}</span></div>
        {status?.certificate&&status.certificate.state!=='valid'&&<div role="status" className="error"><span>本机连接证书{status.certificate.state==='expired'?'已到期':status.certificate.state==='unknown'?'状态待检查':`将在 ${status.certificate.daysRemaining} 天内到期`}。请在任务结束后按安装说明运行 Renew-Certificate.ps1 维护；不要重置配置或删除聊天。</span></div>}
        {error&&<div role="alert" className="error"><span>{error}</span><button className="subtle" aria-label="关闭提示" onClick={()=>setError('')}>×</button></div>}
      <nav className="view-tabs" aria-label="工作台区域">{([['chat','对话'],['documents','Office 文档'],['files','文件库'],['native','原生会话'],['archives','历史档案'],['settings','设置']] as const).map(([id,label])=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}>{label}</button>)}</nav>
      {view==='native'&&<NativeSessions api={api}/>}
      {view==='archives'&&<HistoryArchives api={api} upload={async file=>{const response=await fetch('/api/archives?name='+encodeURIComponent(file.name),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw Error(result.message||'导入失败');return result;}}/>}
      {newTask&&<TaskDialog api={api} catalog={catalog} status={status} documentId={documentId} onClose={()=>setNewTask(false)} onCreate={id=>{setNewTask(false);setActive(id);setView('chat');void guard(refresh);}}/>}
      {view==='files'&&<FileLibrary requestedOpen={fileOpen} onOpenHandled={id=>setFileOpen(old=>old?.requestId===id?null:old)} api={api} upload={uploadFiles} download={downloadFile} previewImage={previewImage} conversation={active} revision={fileRevision} attach={file=>{setAttachments(items=>items.some(f=>f.id===file.id)?items:[...items,file]);setView('chat');}}/>}
      {view==='settings'&&<Settings api={api} catalog={catalog} reload={reloadCatalog} status={status}/>}
      {view==='documents'&&<NativeDocuments api={api} onConnect={async binding=>{setDocumentId(binding.documentId);await refresh();await reloadCatalog();setView('chat');setNewTask(true);}}/>}
      {view==='chat'&&<>
      <RuntimePanel conversation={active} api={api} prepare={command=>{if(content.trim()||attachments.length){setError('当前还有未发送的草稿或附件，请先处理；不会自动覆盖草稿。');return;}setContent(command);}}/>
      <TaskFiles conversation={active} revision={fileRevision} busy={busy} api={api} download={downloadFile} open={(file,action)=>{setFileOpen({requestId:crypto.randomUUID(),conversation:active,fileId:file.id,action});setView('files');}}/>
      {status?.selectionPreview&&selectedDoc?.startsWith('native:')&&<SelectionPreview key={active} conversation={active} enabled={Boolean(doc?.online)&&!busy} api={api} referenceId={selectionRefs[active]} onReference={id=>setSelectionRefs(old=>({...old,[active]:id || undefined}))}/>}
      {selectionRefs[active]&&<p role="status" className="notice">下一条消息已引用固定的 Office 选区。<button type="button" onClick={()=>setSelectionRefs(old=>({...old,[active]:undefined}))}>取消引用</button></p>}
      <section className={'document-card '+(documentPanel?'expanded':'')}><div className="document-top"><div className="file-icon">{doc?.kind==='word'?'W':doc?.kind==='powerpoint'?'P':'X'}</div><div className="document-name"><strong>{doc?.name || '文件任务 · 无在线文档'}</strong><small>{doc?.online?`${doc.kind} 已连接 · 写后校验`:doc?'文档离线，请在 Office 中打开并从文档页连接':'上传附件或从文件库选择文档'}</small></div><button className="subtle" onClick={()=>setDocumentPanel(!documentPanel)}>{documentPanel?'收起':'文档'}</button></div>
        {!doc?.online&&<button className="connect-document" onClick={()=>setView('documents')}>选择打开的 Office 文档</button>}
        {documentPanel&&<div className="document-details"><p className="muted">当前任务绑定不会随切换文件而改变。要操作另一文档，请新建任务。</p>{doc?.kind==='excel'&&<div className="range-fields"><label>工作表<input aria-label="工作表" value={sheet} onChange={e=>setSheet(e.target.value)}/></label><label>范围<input aria-label="范围" value={range} onChange={e=>setRange(e.target.value)}/></label></div>}<div className="actions"><button disabled={!doc?.online} onClick={()=>guard(async()=>setPreview(await api(doc.kind==='excel'?'/api/read':'/api/read-text',doc.kind==='excel'?{documentId:selectedDoc,sheet,range}:{documentId:selectedDoc,count:20})))}>{doc?.kind==='excel'?'读取范围':'读取正文'}</button><button disabled={!doc?.online||!doc?.capabilities?.includes('snapshot')} onClick={()=>guard(async()=>{const result=await api('/api/snapshot',{documentId:selectedDoc,conversationId:active || undefined});setArtifact(result.id);setFileRevision(r=>r+1);})}>保存快照</button>{artifact&&<button onClick={()=>guard(download)}>下载快照</button>}</div>{preview?.values&&<div className="table-wrap"><table><tbody>{preview.values.slice(0,12).map((row:any[],r:number)=><tr key={r}>{row.slice(0,8).map((v,c)=><td key={c}>{String(v ?? '')}</td>)}</tr>)}</tbody></table><small>只显示前 12 行、8 列 · 已记录范围版本</small></div>}{preview?.items&&<div className="text-preview">{preview.sections?.map((s:any)=><button key={s.id} onClick={()=>guard(async()=>setPreview(await api('/api/read-text',{documentId:selectedDoc,slideId:s.id,count:20})))}>{s.name}</button>)}{preview.items.map((item:any,i:number)=><p key={i}>{item.text}</p>)}</div>}</div>}
      </section>
      <section className="chat" aria-label="对话记录">{!active&&<div className="welcome"><span className="welcome-rule"/><h2>把想法，落实到文档。</h2><p>上传文件，或连接当前 Office 文档。<br/>描述任务，查看实际执行与校验结果。</p><button disabled={!status?.coreReady} onClick={()=>guard(createConversation)}>创建任务 →</button><small>文件副本编辑与当前 Office 编辑分别记录。</small></div>}
        {hasOlder&&<button disabled={loadingOlder} onClick={()=>guard(loadOlder)}>{loadingOlder?'加载中…':'加载更早记录'}</button>}
        {messages.filter(m=>!m.hidden).map((m:any,i:number)=><Message key={m.id || m.msg_id || i} message={m}/>)}
        {stream&&!messages.some((m:any)=>m.type==='text'&&m.position==='left'&&stream.endsWith(messageText(m)))&&<article className="message assistant streaming"><div className="message-label">智能体 · 正在回复</div><div className="message-text">{stream}</div></article>}
        {confirmations.map((c:any,i:number)=>Array.isArray(c.questions)&&c.questions.length?<QuestionCard key={c.call_id || i} item={c} submit={async body=>{await api(`/api/conversations/${active}/answer`,body);await refreshConversation(active);}}/>:<div className="approval" key={c.call_id || i}><strong>允许执行 {c.title || c.action || '此工具'}？</strong><p>{c.description}</p><ApprovalDetails confirmation={c}/><button disabled={!c.msg_id||c.canAllow===false} onClick={()=>guard(async()=>{await api(`/api/conversations/${active}/confirm`,{callId:c.call_id || c.id,msgId:c.msg_id,allow:true});await refreshConversation(active);})}>允许这一次</button><button disabled={!c.msg_id||c.canDeny===false} onClick={()=>guard(async()=>{await api(`/api/conversations/${active}/confirm`,{callId:c.call_id || c.id,msgId:c.msg_id,allow:false});await refreshConversation(active);})}>拒绝</button></div>)}
          {operations.filter(o=>o.documentId===selectedDoc).slice(0,8).reverse().map(o=><div className={'operation '+o.status} key={o.id}><span>{labels[o.status] || o.status}</span><strong>{o.kind==='excel.write'?`${o.payload?.sheet} ! ${o.payload?.range}`:o.payload?.target?.kind || o.kind}</strong><small>{o.result?.code || o.result?.message || o.kind}</small>{((o.status==='applied'&&o.result?.before)||o.result?.restoreAvailable)&&!o.id.startsWith('restore_')&&<button disabled={!doc?.online||busy} onClick={()=>{if(window.confirm('恢复这次操作之前的内容？只有目标仍与修改后的版本一致才会执行；不会覆盖后来人工修改的内容。批处理仅恢复已验证的步骤。'))void guard(async()=>{const result=await api('/api/restore',{operationId:o.id});if(result.status!=='applied')throw Error('未恢复：目标已变化或结果需检查。请查看操作记录，不要盲目重试。');await refresh();});}}>恢复本次修改</button>}</div>)}<div ref={lastMessage}/>
      </section>
      <form className="composer" onSubmit={e=>{e.preventDefault();void guard(send);}}>{attachments.length>0&&<div className="attachment-list">{attachments.map(f=><button type="button" key={f.id} onClick={()=>setAttachments(a=>a.filter(x=>x.id!==f.id))}>{f.name} ×</button>)}</div>}<textarea aria-label="任务消息" placeholder={active?'描述任务；上传文件后可在副本上修改。':'先创建任务'} value={content} disabled={!active} onChange={e=>setContent(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void guard(send);}}}/><div className="composer-footer"><label className="upload-button">{uploading?'上传中…':'＋ 附件'}<input aria-label="附加文件" type="file" multiple disabled={!active||uploading||busy} onChange={e=>{const chosen=Array.from(e.target.files || []);e.target.value='';setUploading(true);void guard(async()=>{const result=await uploadFiles(chosen,active);setAttachments(a=>[...a,...result]);setFileRevision(r=>r+1);}).finally(()=>setUploading(false));}}/></label><div>{busy&&<button type="button" className="subtle" onClick={()=>guard(async()=>{await api(`/api/conversations/${active}/cancel`,{});setBusy(false);})}>停止</button>}<button type="submit" disabled={!active||(!content.trim()&&!attachments.length)||busy||uploading}>发送 ↑</button></div></div></form>
      </>}
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
