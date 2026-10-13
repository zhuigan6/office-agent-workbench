import React, { useEffect, useRef, useState } from 'react';
import {Inspection,inspectionNodes} from './Inspection.tsx';

export type Api = (route: string, data?: unknown) => Promise<any>;
export type FileRecord = { id: string; name: string; extension: string; mediaType: string; size: number; sha256: string; createdAt: number; sourceId?: string;version?:number;rootId?:string };
export type FileOpenIntent={requestId:string;conversation:string;fileId:string;action:'inspect'|'preview'|'validate'};
export function resolveFileIntent(intent:FileOpenIntent,conversation:string,files:FileRecord[]){
  if(intent.conversation!==conversation)throw new Error('文件引用属于其他任务，未自动切换目标。');
  const file=files.find(item=>item.id===intent.fileId);if(!file)throw new Error('指定版本的任务文件不可用，未按名称替换为其他文件。');return file;
}
export type Catalog = { agents: { id: string; name: string; available: boolean; backend?: string }[]; providers: { id: string; name: string; platform: string; models: string[]; source: string }[];agentDiscoveryFailed?:boolean };
export function readableSize(size: number) { return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
const failure = (e: unknown) => e instanceof Error ? e.message : String(e);

export function TaskDialog({ api, catalog, status, documentId, onClose, onCreate }: { api: Api; catalog: Catalog; status: any; documentId: string; onClose: () => void; onCreate: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState(documentId?'office':'file'), [name, setName] = useState(''), [agent, setAgent] = useState('aionrs');
  const [providerId, setProvider] = useState('workbench-ccswitch'), [model, setModel] = useState<string>(status?.config?.model || status?.model || '');
  const [doc, setDoc] = useState(documentId), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  const provider = catalog.providers.find(p => p.id === providerId);
  const native = agent !== 'aionrs';
  const selectedAgent = catalog.agents.find(a => a.id === agent);
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (pending) return; setPending(true); setError('');
    try { const result = await api('/api/conversations', { name: name.trim(), ...(kind === 'office' ? { documentId: doc } : {}), agent, ...(!native ? { providerId, ...(model ? { model } : {}) } : {}) }); onCreate(result.id); }
    catch (e) { setError(failure(e)); } finally { setPending(false); }
  }
  return <dialog ref={dialog} className="task-dialog" onCancel={e => { e.preventDefault(); if (!pending) onClose(); }} aria-labelledby="new-task-title">
    <form onSubmit={create} className="product-form"><div className="panel-heading"><div><small>独立任务，独立上下文</small><h2 id="new-task-title">新建任务</h2></div><button type="button" disabled={pending} onClick={onClose} aria-label="关闭新建任务">×</button></div>
      <label>任务名称<input autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="例如：核对九月报表" /></label>
      <fieldset className="task-kinds"><legend>工作方式</legend><label><input type="radio" name="kind" checked={kind === 'file'} onChange={() => setKind('file')} /> 文件 / 对话任务<small>无需打开 Office，稍后上传文件。</small></label><label><input type="radio" name="kind" checked={kind === 'office'} onChange={() => setKind('office')} /> 在线 Office 任务<small>固定绑定所选文档，不自动切换。</small></label></fieldset>
      {kind === 'office' && <label>绑定文档<select required value={doc} onChange={e => setDoc(e.target.value)}><option value="">选择文档</option>{(status?.documents || []).filter((d:any)=>d.documentId.startsWith('native:')).map((d: any) => <option key={d.documentId} value={d.documentId}>{d.name}{d.online ? '' : '（离线）'}</option>)}</select><small>通过 Windows 本地连接器操作已打开的文档，不安装加载项。</small></label>}
      <label>智能体<select value={agent} onChange={e => setAgent(e.target.value)}>{(catalog.agents.length ? catalog.agents : [{ id: 'aionrs', name: 'AionCore', available: false }]).map(a => <option key={a.id} value={a.id}>{a.name}{a.available ? '' : '（当前不可用）'}</option>)}</select></label>
      {native ? <p className="notice">使用此智能体在本机已有的登录与模型配置。此处不发起登录；可用状态不代表所有模型或工具均已验证。</p> : <div className="form-columns"><label>服务商<select value={providerId} onChange={e => { setProvider(e.target.value); setModel(catalog.providers.find(p => p.id === e.target.value)?.models[0] || ''); }}>{!catalog.providers.some(p => p.id === 'workbench-ccswitch') && <option value="workbench-ccswitch">CC-Switch（现有配置）</option>}{catalog.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>模型<input list="task-models" value={model} onChange={e => setModel(e.target.value)} placeholder="使用现有默认模型" /><datalist id="task-models">{provider?.models.map(m => <option key={m} value={m} />)}</datalist></label></div>}
      {selectedAgent && !selectedAgent.available && <p className="notice">此智能体当前不可用，请检查本地配置或选择其他智能体。</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={pending} onClick={onClose}>取消</button><button className="primary" disabled={pending || !name.trim() || (kind === 'office' && !doc) || selectedAgent?.available === false}>{pending ? '正在创建…' : '创建任务'}</button></div>
    </form>
  </dialog>;
}

function Output({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value == null) return <p className="muted">无输出</p>;
  const nodes=depth===0?inspectionNodes(value):null;if(nodes)return <Inspection nodes={nodes}/>;
  if (typeof value === 'string') { if (depth === 0) { try { return <Output value={JSON.parse(value)} depth={1} />; } catch { /* Plain CLI output is displayed as text, never HTML. */ } } return <pre className="plain-output">{value}</pre>; }
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (depth > 3) return <p className="muted">更多嵌套内容见高级原始结果。</p>;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i + 1), v]) : Object.entries(value);
  return <dl className="result-list">{entries.slice(0, 60).map(([key, item]) => <div key={key}><dt>{key}</dt><dd><Output value={item} depth={depth + 1} /></dd></div>)}{entries.length > 60 && <p>仅展示前 60 项；完整内容见高级原始结果。</p>}</dl>;
}

export function FileLibrary({ api, upload, download, previewImage, conversation, revision, attach,requestedOpen,onOpenHandled }: { api: Api; upload: (files: File[], conversation?: string) => Promise<FileRecord[]>; download: (file: FileRecord) => Promise<void>; previewImage:(file:FileRecord)=>Promise<string>; conversation: string; revision: number; attach: (file: FileRecord) => void;requestedOpen?:FileOpenIntent|null;onOpenHandled?:(id:string)=>void }) {
  const [files, setFiles] = useState<FileRecord[]>([]), [scope, setScope] = useState(requestedOpen?'task':'all'), [search, setSearch] = useState(''), [selected, setSelected] = useState<FileRecord | null>(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const generation=useRef(0),handledOpen=useRef('');
  useEffect(()=>{generation.current++;setSelected(null);setResult(null);setHtml(null);setPending(false);return()=>{generation.current++;};},[conversation]);
  const [command, setCommand] = useState('view'), [args, setArgs] = useState('["outline"]'), [commands, setCommands] = useState('[]');
  const [mergeData,setMergeData]=useState('{}');
  const [helpElement,setHelpElement]=useState(''),[helpVerb,setHelpVerb]=useState(''),[helpFields,setHelpFields]=useState('');
  const [dataFileId,setDataFileId]=useState(''),[importSheet,setImportSheet]=useState('/Sheet1'),[startCell,setStartCell]=useState('A1'),[header,setHeader]=useState(true),[delimiter,setDelimiter]=useState(''),[decimal,setDecimal]=useState('.');
  const [result, setResult] = useState<any>(null), [html, setHtml] = useState<string | null>(null);
  const [image,setImage]=useState<string|null>(null);
  const [pdfStart,setPdfStart]=useState('1'),[pdfEnd,setPdfEnd]=useState('3');
  const officeFormat=Boolean(selected&&['docx','xlsx','pptx'].includes(selected.extension));
  const readable=officeFormat||Boolean(selected&&['pdf','txt','md','csv','tsv'].includes(selected.extension));
  const previewable=officeFormat||Boolean(selected&&['png','jpg','jpeg'].includes(selected.extension));
  useEffect(()=>()=>{if(image)URL.revokeObjectURL(image);},[image]);
  useEffect(()=>{setImage(null);},[selected?.id]);
  useEffect(() => {
    let alive = true; setLoading(true);
    api('/api/files' + (scope === 'task' && conversation ? `?conversation=${encodeURIComponent(conversation)}` : '')).then(data => { if (alive) { setFiles(data); setError(''); } }).catch(e => { if (alive) setError(failure(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, conversation, scope, revision, refresh]);
  useEffect(()=>{setHelpElement('');setHelpVerb('');setHelpFields('');},[selected?.id]);
  useEffect(()=>{
    if(!requestedOpen||loading||pending||handledOpen.current===requestedOpen.requestId)return;
    handledOpen.current=requestedOpen.requestId;onOpenHandled?.(requestedOpen.requestId);
    try{const file=resolveFileIntent(requestedOpen,conversation,files);setSelected(file);setCommand('view');setArgs('["outline"]');void run(()=>execute(requestedOpen.action,file,true));}catch(e){setError(failure(e));}
  },[requestedOpen,loading,pending,files,conversation,onOpenHandled]);
  async function run(action: () => Promise<void>) { if (pending) return;const version=generation.current;setPending(true);setError(''); try { await action(); } catch (e) {if(version===generation.current){setError(failure(e));const receipt=(e as any)?.operation;if(receipt)setResult({status:'failed',operation:receipt,batch:receipt.batch});}} finally {if(version===generation.current)setPending(false);} }
  async function execute(action: 'inspect' | 'batch' | 'help' | 'preview' | 'merge' | 'import'|'validate',target=selected,readDefaults=false) {
    if (!target) return;const version=generation.current;
    const payload: any = { fileId: target.id, action:action==='validate'?'inspect':action, ...(action==='help'?{format:target.extension}: {}) };
    if(scope==='task'&&conversation)payload.conversationId=conversation;
    if(action==='help'){
      const topics=[helpElement.trim(),helpVerb.trim()].filter(Boolean);if(topics.length)payload.args=topics;
      const fields=helpFields.split(',').map(field=>field.trim()).filter(Boolean);if(fields.length)payload.fields=fields;
    }
    if (action === 'inspect') { const parsed = readDefaults?['outline']:JSON.parse(args); if (!Array.isArray(parsed) || parsed.some(v => typeof v !== 'string')) throw new Error('参数必须是字符串数组，例如 ["Sheet1"]；不是 shell 命令。'); payload.command = readDefaults?'view':command; payload.args = parsed; }
    if(action==='validate'){payload.command='validate';payload.args=[];}
    if(action==='inspect'&&target.extension==='pdf'){payload.command='view';payload.args=['--start',pdfStart,'--end',pdfEnd];}
      if (action === 'batch') { const parsed = JSON.parse(commands); if (!Array.isArray(parsed) || !parsed.length || parsed.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('批量编辑需要非空 JSON 对象数组。请先查看命令帮助。'); payload.commands = parsed; payload.operationId = crypto.randomUUID(); }
      if(action==='merge'){payload.data=JSON.parse(mergeData);payload.operationId=crypto.randomUUID();}
      if(action==='import')Object.assign(payload,{dataFileId,sheet:importSheet,startCell,header,decimal,...(delimiter?{delimiter}:{}),operationId:crypto.randomUUID()});
    setResult(null); setHtml(null);setImage(null);
    if(action==='preview'&&['png','jpg','jpeg'].includes(target.extension)){const url=await previewImage(target);if(version!==generation.current){URL.revokeObjectURL(url);return;}setImage(url);return;}
    const response = await api('/api/file-command', payload);
    if(version!==generation.current)return;
    if(['inspect','validate','preview','help'].includes(action)&&response.file&&response.file.id!==target.id)throw new Error('返回的文件引用不匹配，未自动切换到其他版本。');
    if (action === 'preview') { if (typeof response.output !== 'string') throw new Error('预览未返回 HTML。'); setHtml(response.output); } else setResult(response);
    if (response.file) { setSelected(response.file); setRefresh(v => v + 1); }
  }
  return <section className="product-page" aria-label="文件库"><div className="panel-heading"><div><h2>文件库</h2><p>保留原件，在副本上修改。</p></div><label className={'upload-button ' + (pending ? 'disabled' : '')}>上传文件<input type="file" multiple disabled={pending} onChange={e => { const chosen = Array.from(e.target.files || []); e.target.value = ''; void run(async () => { await upload(chosen, scope === 'task' ? conversation : undefined); setRefresh(v => v + 1); }); }} /></label></div>
    <p className="muted">每个文件最多 32 MB。下载携带本机授权；文件预览仅在主动请求时生成。</p>
    <div className="file-toolbar"><input aria-label="搜索文件" placeholder="按名称查找文件" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="文件范围" value={scope} onChange={e => setScope(e.target.value)}><option value="all">全部文件</option><option value="task" disabled={!conversation}>当前任务</option></select><button disabled={pending || loading} onClick={() => setRefresh(v => v + 1)}>刷新</button></div>
    {error && <p role="alert" className="error">{error}</p>}{loading && <p role="status">正在读取文件库…</p>}
    <div className="file-layout"><div className="file-list">{!loading && !files.length && <div className="empty-state"><h3>从一份文件开始</h3><p>上传 Word、Excel 或 PowerPoint 文件，即可检查内容或编辑副本。无需 Office 在线。</p></div>}{files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())).map(f => <button key={f.id} disabled={pending} className={'file-row ' + (selected?.id === f.id ? 'selected' : '')} onClick={() => { setSelected(f); setResult(null); setHtml(null); }}><span className="extension">{f.extension || 'FILE'}</span><span><strong>{f.name}</strong><small>{readableSize(f.size)}{f.sourceId ? ' · 编辑副本' : ' · 原始文件'}</small></span></button>)}</div>
      {selected ? <section className="file-inspector" aria-label="文件操作"><h3>{selected.name}</h3><p className="muted">{readableSize(selected.size)} · {new Date(selected.createdAt).toLocaleString()}</p><div className="actions"><button disabled={pending} onClick={() => void run(() => download(selected))}>下载</button><button disabled={!conversation || pending} onClick={() => attach(selected)}>附加到当前任务</button><button disabled={pending||!previewable} onClick={() => void run(() => execute('preview'))}>生成预览</button>{officeFormat&&<button disabled={pending} onClick={() => void run(() => execute('help'))}>命令帮助</button>}</div>
        {readable?<div className="inspect-controls">{officeFormat?<label>只读检查<select value={command} onChange={e => setCommand(e.target.value)}>{[['view', '查看内容'], ['get', '读取对象'], ['query', '查询'], ['validate', '验证文件'], ['raw', '原始结构'], ['dump', '完整结构']].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>:<span>只读文本</span>}{selected.extension==='pdf'&&<><label>起始页<input aria-label="PDF 起始页" type="number" min="1" value={pdfStart} onChange={e=>setPdfStart(e.target.value)}/></label><label>结束页<input aria-label="PDF 结束页" type="number" min="1" value={pdfEnd} onChange={e=>setPdfEnd(e.target.value)}/></label></>}<button disabled={pending} onClick={() => void run(() => execute('inspect'))}>运行检查</button></div>:<p className="muted">此附件可以下载或交给支持该格式的智能体处理，不使用 Office 文档结构命令修改。</p>}
        {selected.extension==='pdf'&&<p className="muted">每次最多读取 5 页、24,000 字符的文本层。不包含 OCR；扫描件、图表及排版需另做视觉验收。</p>}
        {officeFormat&&<details className="advanced"><summary>高级检查参数</summary><label>字符串数组（不接受 shell 命令）<textarea aria-label="检查参数" spellCheck={false} value={args} onChange={e => setArgs(e.target.value)} /></label></details>}
        {officeFormat&&<details className="advanced"><summary>按需查看上游命令帮助</summary><p>直接查询本机 OfficeCLI 的帮助，不另造文档操作。全部留空读取格式概览；指定元素或操作后，再选择需要的属性，减少无关说明。</p><div className="form-columns"><label>元素类型<input aria-label="帮助元素类型" maxLength={80} placeholder="例如 paragraph、table、cell" value={helpElement} onChange={e=>setHelpElement(e.target.value)}/></label><label>操作或主题<input aria-label="帮助操作或主题" maxLength={80} placeholder="可选，以原版帮助为准" value={helpVerb} onChange={e=>setHelpVerb(e.target.value)}/></label></div><label>属性名称（英文逗号分隔，最多 20 个）<input aria-label="帮助属性名称" maxLength={1600} placeholder="例如 text, align" value={helpFields} onChange={e=>setHelpFields(e.target.value)}/></label><button disabled={pending} onClick={()=>void run(()=>execute('help'))}>查询指定帮助</button></details>}
        {officeFormat&&<details className="advanced"><summary>在新副本上批量编辑</summary><p>原文件不会覆盖。先查看命令帮助，再输入 OfficeCLI 支持的命令对象数组。具体命令能力由本机 OfficeCLI 决定。</p><label>命令 JSON<textarea aria-label="命令 JSON" rows={7} spellCheck={false} value={commands} onChange={e => setCommands(e.target.value)} /></label><button className="primary" disabled={pending || commands.trim() === '[]'} onClick={() => void run(() => execute('batch'))}>执行并创建副本</button></details>}
          {pending && <p role="status">正在处理，请勿重复提交…</p>}
          {selected.extension==='xlsx'&&<details className="advanced"><summary>导入 CSV / TSV 到新版本</summary><p>先上传数据文件，再选择目标工作表。只修改新副本，不覆盖原工作簿。</p><label>数据文件<select aria-label="导入数据文件" value={dataFileId} onChange={e=>setDataFileId(e.target.value)}><option value="">选择已上传的 CSV / TSV</option>{files.filter(f=>['csv','tsv'].includes(f.extension)).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><div className="form-columns"><label>工作表路径<input aria-label="导入工作表" value={importSheet} onChange={e=>setImportSheet(e.target.value)}/></label><label>起始单元格<input aria-label="导入起始单元格" value={startCell} onChange={e=>setStartCell(e.target.value)}/></label><label>分隔符<select aria-label="导入分隔符" value={delimiter} onChange={e=>setDelimiter(e.target.value)}><option value="">按文件类型</option><option value=",">逗号</option><option value=";">分号</option><option value="|">竖线</option><option value={'\t'}>制表符</option></select></label><label>小数点<select aria-label="导入小数点" value={decimal} onChange={e=>setDecimal(e.target.value)}><option value=".">点号</option><option value=",">逗号</option></select></label></div><label><input type="checkbox" checked={header} onChange={e=>setHeader(e.target.checked)}/>首行为表头</label><button disabled={pending||!dataFileId} onClick={()=>void run(()=>execute('import'))}>导入到新版本</button></details>}
          {officeFormat&&<details className="advanced"><summary>填充模板并创建新版本</summary><p>替换模板内的 {'{{字段名}}'}。输入 JSON 字段和值，不填写磁盘路径；原模板保留。</p><textarea aria-label="模板数据 JSON" rows={5} value={mergeData} onChange={e=>setMergeData(e.target.value)}/><button disabled={pending||mergeData.trim()==='{}'} onClick={()=>void run(()=>execute('merge'))}>填充模板</button></details>}
        {image&&<div className="preview-panel"><div className="panel-heading"><strong>图片预览</strong><button onClick={()=>setImage(null)}>关闭预览</button></div><img alt={selected.name} src={image} style={{maxWidth:'100%',maxHeight:420,objectFit:'contain'}}/></div>}
        {html !== null && <div className="preview-panel"><div className="panel-heading"><strong>隔离预览</strong><button onClick={() => setHtml(null)}>关闭预览</button></div><iframe title={`${selected.name} 的安全预览`} srcDoc={html} sandbox="" referrerPolicy="no-referrer" /></div>}
        {result?.truncated&&<p className="notice">结果过大，这里只返回部分内容，不代表整份文档已检查。{typeof result.output?.omittedResultCount==='number'&&<>已保留 {result.output.returnedResultCount} 个完整对象，另有 {result.output.omittedResultCount} 个对象未返回。</>}请按对象路径、范围、页码、深度或数量限制继续查询。</p>}
        {result?.batch&&<section className="command-result" aria-label="批量执行回执"><h3>批量执行回执</h3><p>执行 {result.batch.summary.executed} 项，成功 {result.batch.summary.succeeded} 项，失败 {result.batch.summary.failed} 项，跳过 {result.batch.summary.skipped} 项。</p>{result.operation?.copyPublished===false&&<p className="notice">本批次没有发布新副本；原文件没有被本次批次覆盖。{result.operation.replayed===false?'本次只返回已有记录，没有重新执行。':''}</p>}{result.batch.upstreamReportedRollback===true&&<p className="muted">OfficeCLI 报告已回滚工作副本；这不是正在打开的 Office 文档撤销。</p>}{result.batch.failedSteps.map((step:any,i:number)=><p key={i}>上游失败索引 {step.index??'未知'}：{step.error}</p>)}{result.batch.omittedFailureSteps>0&&<p>另有 {result.batch.omittedFailureSteps} 项失败信息保留在本地记录。</p>}{result.batch.readResults.length>0&&<><p className="muted">以下读取结果对应命令执行当时的工作副本，不保证与最终文件相同。最终成品仍需检查。</p>{result.batch.readResults.map((read:any)=><details key={read.index}><summary>读取结果 · 索引 {read.index} · {read.command}</summary>{read.truncated&&<p className="notice">读取结果过大，仅返回部分完整内容，请缩小范围继续查询。</p>}<Output value={read.output}/></details>)}</>}{result.batch.omittedReadResults>0&&<p className="notice">另有 {result.batch.omittedReadResults} 个读取结果未返回，请对相应对象单独检查。</p>}</section>}
        {result && <section className="command-result" aria-live="polite"><h3>{result.status?.startsWith('created') ? '已生成独立副本' : '检查结果'}</h3>{result.changes&&<><h4>修改范围</h4><p>文档包内部：新增 {result.changes.added} 项，修改 {result.changes.modified} 项，删除 {result.changes.removed} 项，保持不变 {result.changes.unchanged} 项。</p><p className="muted">这是文档包结构对比，不等于版式或内容正确性验收；元数据变化也会计入。请结合预览和内容读回。</p><details><summary>查看变化部件</summary><Output value={result.changes.parts}/></details></>}<Output value={result.output} />{result.validation != null && <><h4>验证结果</h4><Output value={result.validation} /></>}<details className="advanced"><summary>高级原始结果</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></section>}
        <details className="advanced"><summary>文件来源与校验</summary><dl><dt>文件 ID</dt><dd>{selected.id}</dd><dt>版本</dt><dd>{selected.version?`v${selected.version}（相对源文件的编辑代次）`:'旧记录：按来源链查看'}</dd><dt>SHA-256</dt><dd>{selected.sha256}</dd>{selected.sourceId && <><dt>来源文件</dt><dd>{selected.sourceId}</dd></>}{selected.rootId&&<><dt>原件 ID</dt><dd>{selected.rootId}</dd></>}</dl></details>
      </section> : <div className="empty-state"><h3>选择文件</h3><p>查看内容、下载或创建编辑副本。所有写入都与在线 Office 操作分开。</p></div>}
    </div></section>;
}

export function Settings({ api, catalog, reload, status }: { api: Api; catalog: Catalog; reload: () => Promise<void>; status: any }) {
  const [error, setError] = useState(''), [saved, setSaved] = useState(''), [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending) return; const form = e.currentTarget, data = new FormData(form); setPending(true); setError(''); setSaved('');
    try { const models = String(data.get('models')).split(/[\n,]/).map(m => m.trim()).filter(Boolean); if (!models.length) throw new Error('请至少填写一个模型 ID。'); await api('/api/providers', { name: data.get('name'), platform: data.get('platform'), baseUrl: data.get('baseUrl'), apiKey: data.get('apiKey'), models }); form.reset(); setSaved('服务商已添加。新建任务时可选择；现有任务不变。'); await reload(); }
    catch (e) { setError(failure(e)); } finally { const input = form.elements.namedItem('apiKey') as HTMLInputElement; input.value = ''; setPending(false); }
  }
  return <section className="product-page settings-page"><div className="panel-heading"><div><h2>设置</h2><p>本机连接与任务默认值</p></div><button disabled={pending} onClick={() => { setError(''); void reload().catch(e => setError(failure(e))); }}>刷新状态</button></div>
    <section className="settings-section"><h3>运行环境</h3><p>{status?.coreReady ? 'AionCore 已就绪' : 'AionCore 尚未就绪'} · 默认模型：{status?.config?.model || status?.model || '由现有配置决定'}</p><p className="muted">外置工作台通过 Windows 本地连接器连接已打开的 Office 文档。智能体已检测到不等于其登录、额度和全部功能已经验证。</p>{catalog.agents.map(a => <div className="setting-row" key={a.id}><strong>{a.name}</strong><span>{a.available ? '已检测到' : '当前不可用'}{a.id !== 'aionrs' ? ' · 使用本机已有登录' : ''}</span></div>)}</section>
    {catalog.agentDiscoveryFailed&&<p role="alert" className="notice">暂未读取到上游智能体目录。请刷新状态；这不代表本机智能体已卸载，也不影响已保留的聊天记录。</p>}
    <section className="settings-section"><h3>已配置服务商</h3>{catalog.providers.map(p => <div className="provider-row" key={p.id}><strong>{p.name}</strong><small>{p.platform} · {p.source}</small><p>{p.models.join('、') || '模型由现有配置决定'}</p></div>)}<p className="muted">配置存在不代表凭据、额度或所有模型已通过运行验证。</p></section>
    <form className="product-form settings-section" onSubmit={submit}><h3>添加服务商</h3><p className="muted">密钥仅发送给本机服务端，不回显、不写入浏览器存储。不会更改已有任务。</p><div className="form-columns"><label>名称<input name="name" required maxLength={100} /></label><label>协议<select name="platform"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label></div><label>API 地址<input name="baseUrl" type="url" required placeholder="https://api.example.com" /></label><label>API 密钥<input name="apiKey" type="password" autoComplete="off" required /></label><label>模型 ID（每行一个或逗号分隔）<textarea name="models" required rows={3} /></label><button className="primary" disabled={pending}>{pending ? '正在保存…' : '添加服务商'}</button></form>
    {error && <p className="error" role="alert">{error}</p>}{saved && <p className="notice" role="status">{saved}</p>}
  </section>;
}
