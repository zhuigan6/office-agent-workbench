import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Api } from './Product.tsx';
import type { NativeJournalEvent } from '../../../packages/contracts/native-session.ts';
import { sendIntent, acknowledgeIntent } from './send-intent.ts';
import { nativeDraftKey, readNativeDrafts } from './native-drafts.ts';
import {SelectionPreview} from './SelectionPreview.tsx';
import {NativeLayoutSummary,NativeOperationDetails} from './NativeOperationView.tsx';
import './native-sessions.css';

interface Session { linkId: string; name: string; connected: boolean; pending: boolean; activeTurnId?:string|null;canRetire?:boolean;canInterrupt?:boolean;canResume?:boolean;canReconcile?:boolean;reconciliation?:{ready:boolean;reason:string;replayed:boolean;outcomes:{messageId:string;state:string}[]}|null;terminalSharing?: boolean; documentToolsConnected?:boolean;document?:{taskId:string;documentId:string;name:string}|null;vendorSessionId: string; runtime?: { version: string }; owner?: { status: string } }
interface Approval {callId:string;turnId:string;tool:string;arguments:unknown;document:{name:string}}
interface DocumentOperation {id:string;kind:string;status:string;updatedAt?:number;payload?:unknown;view?:{canRestore:boolean;receipt:unknown};result?:{verified?:boolean;before?:unknown;code?:string;restoreAvailable?:boolean};recovery?:{status:string;retainedUnusedStyleDeclarations?:string[];layoutDeclarationsNormalized?:boolean;retainedEmptyFontAliases?:number[];retainedBlankUsedRange?:boolean}|null}
export function NativeSessions({ api }: { api: Api }) {
  const [sessions, setSessions] = useState<Session[]>([]), [active, setActive] = useState(''), [name, setName] = useState('');
  const [events, setEvents] = useState<NativeJournalEvent[]>([]), [after, setAfter] = useState(0), [next, setNext] = useState(0), [more, setMore] = useState(false);
  const [previous, setPrevious] = useState<number[]>([]), [drafts, setDrafts] = useState<Record<string, string>>(() => readNativeDrafts(sessionStorage));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [tasks,setTasks]=useState<{id:string;name:string;documentId:string}[]>([]),[taskId,setTaskId]=useState('');
  const [approvals,setApprovals]=useState<Approval[]>([]),[selectionId,setSelectionId]=useState<string|null>(null);
  const [operations,setOperations]=useState<DocumentOperation[]>([]);
  const [operationBefore,setOperationBefore]=useState<string|undefined>(),[operationPrevious,setOperationPrevious]=useState<(string|undefined)[]>([]),[operationMore,setOperationMore]=useState(false),[operationNext,setOperationNext]=useState<string|null>(null),[operationTotal,setOperationTotal]=useState(0);
  const [operationLoading,setOperationLoading]=useState(false),operationGeneration=useRef(0);
  const generation = useRef(0);
  const current = sessions.find(session => session.linkId === active), draft = drafts[active] ?? '';
  useEffect(() => { try { sessionStorage.setItem(nativeDraftKey, JSON.stringify(drafts)); } catch { setError('草稿存储不可用，请勿关闭页面；发送不会绕过请求编号保护。'); } }, [drafts]);
  async function refreshList() { const result = await api('/api/native-sessions'); setSessions(result.items); }
  useEffect(() => {
    void api('/api/conversations').then(result=>setTasks(Array.isArray(result)?result:[])).catch(e=>setError(e instanceof Error?e.message:'读取文档任务失败'));
  },[api]);
  useEffect(() => {
    let alive=true,refreshing=false;setApprovals([]);setOperations([]);setOperationLoading(Boolean(active));
    if(!active)return;
    const refresh=async()=>{if(refreshing)return;refreshing=true;try{const value=await api(`/api/native-sessions/${active}/approvals`),ops=await api(`/api/native-sessions/${active}/operations?summary=1${operationBefore?'&before='+encodeURIComponent(operationBefore):''}`);if(alive){setApprovals(value);setOperations(ops.items);setOperationMore(ops.hasMore);setOperationNext(ops.nextCursor);setOperationTotal(ops.total);}}catch(e){if(alive)setError(e instanceof Error?e.message:'读取审批失败');}finally{refreshing=false;if(alive)setOperationLoading(false);}};
    void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{alive=false;clearInterval(timer);};
  },[active,api,operationBefore]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { try { const result = await api('/api/native-sessions'); if (alive) setSessions(result.items); } catch (e) { if (alive) setError(e instanceof Error ? e.message : '读取原生会话失败'); } };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [api]);
  useEffect(() => {
    const version = ++generation.current; setEvents([]);
    if (!active) return;
    const refresh = async () => { try {
      const result = await api(`/api/native-sessions/${active}/events?after=${after}`);
      if (version === generation.current) { setEvents(result.items); setNext(result.nextCursor); setMore(result.hasMore); }
    } catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : '读取记录失败'); } };
    void refresh(); const timer = setInterval(() => void refresh(), 1500);
    return () => { generation.current++; clearInterval(timer); };
  }, [active, after, api]);
  function select(id: string) { operationGeneration.current++;setActive(id); setAfter(0); setPrevious([]); setError('');setSelectionId(null);setOperations([]);setApprovals([]);setOperationBefore(undefined);setOperationPrevious([]);setOperationMore(false);setOperationNext(null);setOperationTotal(0); }
  async function create() {
    if (busy || !name.trim()) return; setBusy(true); setError('');
    try { const result = await api('/api/native-sessions', { name: name.trim(),...(taskId?{taskId}:{}) }); await refreshList(); select(result.linkId); setName(''); }
    catch (e) { setError(e instanceof Error ? e.message : '创建失败'); } finally { setBusy(false); }
  }
  async function send() {
    if (busy || !current?.connected || current.pending || !draft.trim()) return;
    const id = active, submitted = draft;
    setBusy(true); setError('');
    try {
      const intent = sendIntent(sessionStorage, 'native:' + id, JSON.stringify({text:submitted,selectionId}));
      await api(`/api/native-sessions/${id}/send`, { messageId: intent, text: submitted,...(selectionId?{selectionId}:{}) });
      acknowledgeIntent(sessionStorage, 'native:' + id, intent);
      setDrafts(old => old[id] === submitted ? { ...old, [id]: '' } : old);
      await refreshList();
    } catch (e) { setError(e instanceof Error ? e.message : '发送结果待确认，请查看回执，不要重复创建会话'); }
    finally { setBusy(false); }
  }
  async function confirm(callId:string,allow:boolean){
    if(busy)return;setBusy(true);setError('');const id=active;
    try{await api(`/api/native-sessions/${id}/confirm`,{callId,allow});setApprovals(await api(`/api/native-sessions/${id}/approvals`));await refreshList();}
    catch(e){setError(e instanceof Error?e.message:'审批结果待确认');}finally{setBusy(false);}
  }
  async function close() {
    if (!current || busy) return; setBusy(true); setError('');
    try { await api(`/api/native-sessions/${active}/close`, {}); await refreshList(); }
    catch (e) { setError(e instanceof Error ? e.message : '关闭失败'); } finally { setBusy(false); }
  }
  async function resume(){
    if(busy||!current?.canResume)return;const id=active;setBusy(true);setError('');
    try{await api(`/api/native-sessions/${id}/resume`,{});setSelectionId(null);await refreshList();}
    catch(e){setError(e instanceof Error?e.message:'接续失败，原会话历史保留');}finally{setBusy(false);}
  }
  async function reconcile(){
    if(busy||!current?.canReconcile)return;const id=active;setBusy(true);setError('');
    try{const result=await api(`/api/native-sessions/${id}/reconcile`,{});setSelectionId(null);await refreshList();if(!result.ready)setError('核对尚不能解除阻塞：'+result.reason+'。旧消息未重发，文档未自动恢复。');}
    catch(e){setError(e instanceof Error?e.message:'异常状态核对失败，记录保留');}finally{setBusy(false);}
  }
  async function retire(){
    if(busy||!current?.canRetire)return;const id=active;setBusy(true);setError('');
    try{await api(`/api/native-sessions/${id}/retire`,{});setSelectionId(null);await refreshList();}
    catch(e){setError(e instanceof Error?e.message:'失联连接未关闭，原状态保留');}finally{setBusy(false);}
  }
  async function interrupt(){
    if(busy||!current?.activeTurnId)return;setBusy(true);setError('');
    try{await api(`/api/native-sessions/${active}/interrupt`,{});await refreshList();}
    catch(e){setError(e instanceof Error?e.message:'停止结果待确认，请核对本轮记录');}finally{setBusy(false);}
  }
  async function restore(operationId:string){
    if(busy||current?.pending||!window.confirm('恢复这次文档修改？仅在目标仍与修改后的版本一致时执行，不覆盖后来的人工修改。'))return;
    const id=active;setBusy(true);setError('');
    const version=operationGeneration.current;
    try{const result=await api(`/api/native-sessions/${id}/restore`,{operationId});if(result.status!=='applied')throw Error('恢复未完成：目标已变化或结果待核对。');const page=await api(`/api/native-sessions/${id}/operations?summary=1${operationBefore?'&before='+encodeURIComponent(operationBefore):''}`);if(version===operationGeneration.current){setOperations(page.items);setSelectionId(null);}}
    catch(e){if(version===operationGeneration.current)setError(e instanceof Error?e.message:'恢复结果待核对');}finally{setBusy(false);}
  }
  return <section className="product-panel native-session-panel" aria-label="原生智能体会话">
    <div className="panel-heading"><div><small>当前接入 Codex App Server</small><h2>原生会话</h2></div></div>
    <p className="notice">共享会话可在工作台与独立 Codex 终端接续。创建时选择文档任务，两处使用同一授权文档；工具请求在这里确认。正常空闲关闭后可显式接续原会话；异常中断保留记录，不自动重放未知操作。</p>
    <label>连接文档任务<select value={taskId} disabled={busy} onChange={e=>setTaskId(e.target.value)}><option value="">仅聊天，不连接文档</option>{tasks.map(task=><option key={task.id} value={task.id}>{task.name}{task.documentId?'':'（文件任务）'}</option>)}</select></label>
    <div className="native-create-grid"><label>新会话名称<input maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><button disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? '处理中…' : '创建 Codex 原生会话'}</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <label>会话<select aria-label="选择原生会话" value={active} disabled={busy} onChange={e => select(e.target.value)}><option value="">选择原生会话</option>{sessions.map(session => <option key={session.linkId} value={session.linkId}>{session.name}{session.connected ? '' : '（离线历史）'}</option>)}</select></label>
    {current && <><p className="muted native-session-meta">Codex {current.runtime?.version} · {current.connected ? (current.pending ? '执行中或待确认' : '已连接') : '离线，历史保留'} · 原生会话 ID：{current.vendorSessionId}</p>
      {current.documentToolsConnected&&<p>已连接文档任务：{current.document?.name}。工具审批在此窗口进行。</p>}
      {!current.connected&&current.canResume&&<button disabled={busy} onClick={()=>void resume()}>接续原会话</button>}
      {!current.connected&&current.canReconcile&&<button disabled={busy} onClick={()=>void reconcile()}>核对异常状态，不重发</button>}
      {current.canRetire&&<><button disabled={busy} onClick={()=>void retire()}>关闭失联的专属连接</button><p className="muted">仅关闭本工作台仍持有的失联子进程、拒绝旧审批；不清空执行记录。关闭后再核对原会话状态。</p></>}
      {current.reconciliation&&<details className="tool-record"><summary>最近异常核对：{current.reconciliation.ready?'可显式接续':'仍需核对'}</summary><pre>{JSON.stringify(current.reconciliation,null,2)}</pre><p className="muted">核对不重发旧消息、不自动重做或恢复文档。明确中断的任务与成功完成的任务分别记录；接续后重新引用选区。</p></details>}
      {!current.connected&&!current.canResume&&<p className="muted">此连接有待核对的执行状态，或没有可验证的运行元数据。历史保留，不以新会话替代。</p>}
      {current.terminalSharing && <details className="tool-record"><summary>在独立 Codex 终端接续同一会话</summary><p>在本项目目录的 PowerShell 中执行下列命令。终端退出不停止会话；文档工具审批在本窗口处理。</p><pre>{`& .\\scripts\\Start-NativeTerminal.ps1 -LinkId '${current.linkId}'`}</pre></details>}
      {current.connected&&current.document?.documentId.startsWith('native:')&&<SelectionPreview conversation={active} enabled={!busy&&!current.pending} api={api} onReference={setSelectionId} referenceId={selectionId??undefined} endpoint={`/api/native-sessions/${active}/selection`}/>}
      {approvals.map(approval=><article key={approval.callId} className="tool-record" aria-label="原生文档工具审批"><strong>{approval.tool} · {approval.document.name}</strong><pre>{JSON.stringify(approval.arguments,null,2)}</pre><button disabled={busy} onClick={()=>void confirm(approval.callId,true)}>批准本次文档操作</button><button disabled={busy} onClick={()=>void confirm(approval.callId,false)}>拒绝本次文档操作</button></article>)}
      {operations.length>0&&<section aria-label="本会话文档修改"><h3>本会话文档修改</h3><p className="muted">原位操作与聊天保留在同一任务中。恢复之后重新捕获选区引用再编辑。批处理逐步记录，不是原子事务；仅可恢复已验证的步骤。</p>{operations.slice(0,20).map(op=><article key={op.id} className="tool-record" data-operation-id={op.id}><span hidden>{op.id}</span><strong>{op.kind} · {op.recovery?.status==='applied'?(op.status==='applied'?'已恢复':'已恢复已应用步骤'):op.status}</strong><NativeLayoutSummary kind={op.kind} receipt={op.view?.receipt} recovered={op.recovery?.status==='applied'}/>{Boolean(op.recovery?.retainedUnusedStyleDeclarations?.length)&&<p className="muted">正文与格式已核对恢复；Word 保留了未使用的内置样式声明，不表示原包字节完全一致。</p>}{op.recovery?.layoutDeclarationsNormalized&&<p className="muted">表格实际排版属性与内容已核对恢复；Word 规范化了排版声明，不表示原始 XML 或继承关系完全相同。</p>}<NativeOperationDetails api={api} linkId={active} operationId={op.id} version={`${op.updatedAt??0}:${op.recovery?.status??''}`}/>{(op.view?.canRestore??(((op.status==='applied'&&op.result?.verified&&Boolean(op.result.before))||op.result?.restoreAvailable)&&op.recovery?.status!=='applied'))&&<button disabled={busy||current.pending} onClick={()=>void restore(op.id)}>恢复本次修改</button>}</article>)}</section>}
      {operations.some(op=>Boolean(op.recovery?.retainedEmptyFontAliases?.length))&&<p className="notice">PPT 文字、字体和主题颜色已核对恢复；Office 把部分原先未指定的字体别名表示为为空的显式值。验证记录保留此差异，不表示原始文件或继承标记完全相同。</p>}
      {operations.some(op=>op.recovery?.retainedBlankUsedRange)&&<p className="notice">Excel 表格与本次追加区域的内容、实际格式已恢复；工作表 UsedRange 仍可能记住清空后的空白范围。不自动保存原文件，也不宣称原始 XML 完全相同。</p>}
      {operationTotal>0&&<div className="native-pages" aria-label="文档修改记录分页"><span className="muted">共 {operationTotal} 条记录{operationLoading?' · 读取中…':''}</span><button disabled={busy||operationLoading||operationPrevious.length===0} onClick={()=>{setOperationLoading(true);setOperationBefore(operationPrevious.at(-1));setOperationPrevious(values=>values.slice(0,-1));}}>较新修改</button><button disabled={busy||operationLoading||!operationMore||!operationNext} onClick={()=>{setOperationLoading(true);setOperationPrevious(values=>[...values,operationBefore]);setOperationBefore(operationNext!);}}>更早修改</button><button disabled={busy||operationLoading||operationBefore===undefined} onClick={()=>{setOperationLoading(true);setOperationBefore(undefined);setOperationPrevious([]);}}>最近修改</button></div>}
      <div className="native-message-list" aria-label="原生会话公开记录" aria-live="polite">{events.map(({ seq, event }) =>
        'text' in event && (event.kind === 'user.text' || event.kind === 'assistant.text') ? <article key={seq} className={'native-message ' + (event.kind === 'user.text' ? 'user' : 'assistant')}><strong>{event.kind === 'user.text' ? '你' : 'Codex'}</strong><Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>图片引用：{alt || '外部图像未自动加载'}</span> }}>{event.text}</Markdown></article> :
          <details key={seq} className="tool-record native-event"><summary>{event.kind === 'turn.started' ? '开始处理' : event.kind === 'turn.completed' ? '本轮已结束（不代表文档修改成功）' : event.kind === 'turn.outcome' ? event.status==='failed'?event.failureCode==='WORKSPACE_ROUTING_TIMEOUT'?'本轮失败：Codex 工作区路由超时，未自动重试':'本轮失败，未自动重试':event.status==='interrupted'?'本轮已中断，文档不会自动撤销':'本轮模型处理完成；文档结果以验证记录为准' : event.kind === 'tool.call' ? `调用工具：${event.name}` : event.kind === 'tool.result' ? '工具返回结果' : '连接状态更新'}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
      )}</div>
      <div className="native-pages"><button disabled={!previous.length} onClick={() => { setAfter(previous.at(-1)!); setPrevious(values => values.slice(0, -1)); }}>上一页记录</button><button disabled={!more} onClick={() => { setPrevious(values => [...values, after]); setAfter(next); }}>下一页记录</button></div>
      <div className="native-compose"><label>发送给原生会话<textarea aria-label="原生会话消息" maxLength={32768} value={draft} disabled={busy} onChange={e => setDrafts(old => ({ ...old, [active]: e.target.value }))} /></label>
      <div className="native-actions"><button disabled={busy || !current.connected || current.pending || !draft.trim()} onClick={() => void send()}>发送到同一会话</button>
      {current.connected&&current.canInterrupt&&<button disabled={busy} onClick={()=>void interrupt()}>停止当前轮，不撤销文档</button>}
      <button disabled={busy || !current.connected || current.pending} onClick={() => void close()}>关闭空闲连接，保留历史</button></div></div>
    </>}
  </section>;
}
