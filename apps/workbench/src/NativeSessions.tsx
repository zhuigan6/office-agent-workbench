import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Api } from './Product.tsx';
import type { NativeJournalEvent } from '../../../packages/contracts/native-session.ts';
import { sendIntent, acknowledgeIntent } from './send-intent.ts';
import { nativeDraftKey, readNativeDrafts } from './native-drafts.ts';
import './native-sessions.css';

interface Session { linkId: string; name: string; connected: boolean; pending: boolean; terminalSharing?: boolean; vendorSessionId: string; runtime?: { version: string }; owner?: { status: string } }
export function NativeSessions({ api }: { api: Api }) {
  const [sessions, setSessions] = useState<Session[]>([]), [active, setActive] = useState(''), [name, setName] = useState('');
  const [events, setEvents] = useState<NativeJournalEvent[]>([]), [after, setAfter] = useState(0), [next, setNext] = useState(0), [more, setMore] = useState(false);
  const [previous, setPrevious] = useState<number[]>([]), [drafts, setDrafts] = useState<Record<string, string>>(() => readNativeDrafts(sessionStorage));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const current = sessions.find(session => session.linkId === active), draft = drafts[active] ?? '';
  useEffect(() => { try { sessionStorage.setItem(nativeDraftKey, JSON.stringify(drafts)); } catch { setError('草稿存储不可用，请勿关闭页面；发送不会绕过请求编号保护。'); } }, [drafts]);
  async function refreshList() { const result = await api('/api/native-sessions'); setSessions(result.items); }
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
  function select(id: string) { setActive(id); setAfter(0); setPrevious([]); setError(''); }
  async function create() {
    if (busy || !name.trim()) return; setBusy(true); setError('');
    try { const result = await api('/api/native-sessions', { name: name.trim() }); await refreshList(); select(result.linkId); setName(''); }
    catch (e) { setError(e instanceof Error ? e.message : '创建失败'); } finally { setBusy(false); }
  }
  async function send() {
    if (busy || !current?.connected || current.pending || !draft.trim()) return;
    const id = active, submitted = draft;
    setBusy(true); setError('');
    try {
      const intent = sendIntent(sessionStorage, 'native:' + id, submitted);
      await api(`/api/native-sessions/${id}/send`, { messageId: intent, text: submitted });
      acknowledgeIntent(sessionStorage, 'native:' + id, intent);
      setDrafts(old => old[id] === submitted ? { ...old, [id]: '' } : old);
      await refreshList();
    } catch (e) { setError(e instanceof Error ? e.message : '发送结果待确认，请查看回执，不要重复创建会话'); }
    finally { setBusy(false); }
  }
  async function close() {
    if (!current || busy) return; setBusy(true); setError('');
    try { await api(`/api/native-sessions/${active}/close`, {}); await refreshList(); }
    catch (e) { setError(e instanceof Error ? e.message : '关闭失败'); } finally { setBusy(false); }
  }
  return <section className="product-panel native-session-panel" aria-label="原生智能体会话">
    <div className="panel-heading"><div><small>当前接入 Codex App Server</small><h2>原生会话</h2></div></div>
    <p className="notice">使用已安装 Codex 的原生配置。新会话可在本工作台与独立终端接续，不接管其他终端。当前仅开放对话与公开事件记录，尚未连接文档工具；重启后的历史可读，但不自动接管旧执行者。</p>
    <div className="native-create-grid"><label>新会话名称<input maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><button disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? '处理中…' : '创建 Codex 原生会话'}</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <label>会话<select aria-label="选择原生会话" value={active} disabled={busy} onChange={e => select(e.target.value)}><option value="">选择原生会话</option>{sessions.map(session => <option key={session.linkId} value={session.linkId}>{session.name}{session.connected ? '' : '（离线历史）'}</option>)}</select></label>
    {current && <><p className="muted native-session-meta">Codex {current.runtime?.version} · {current.connected ? (current.pending ? '执行中或待确认' : '已连接') : '离线，历史保留'} · 原生会话 ID：{current.vendorSessionId}</p>
      {current.terminalSharing && <details className="tool-record"><summary>在独立 Codex 终端接续同一会话</summary><p>在本项目目录的 PowerShell 中执行下列命令。终端退出不停止会话；请勿同时从两处发起任务。此入口尚未接入文档工具。</p><pre>{`& .\\scripts\\Start-NativeTerminal.ps1 -LinkId '${current.linkId}'`}</pre></details>}
      <div className="native-message-list" aria-label="原生会话公开记录" aria-live="polite">{events.map(({ seq, event }) =>
        'text' in event && (event.kind === 'user.text' || event.kind === 'assistant.text') ? <article key={seq} className={'native-message ' + (event.kind === 'user.text' ? 'user' : 'assistant')}><strong>{event.kind === 'user.text' ? '你' : 'Codex'}</strong><Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>图片引用：{alt || '外部图像未自动加载'}</span> }}>{event.text}</Markdown></article> :
        <details key={seq} className="tool-record native-event"><summary>{event.kind === 'turn.started' ? '开始处理' : event.kind === 'turn.completed' ? '本轮已完成' : event.kind === 'tool.call' ? `调用工具：${event.name}` : event.kind === 'tool.result' ? '工具返回结果' : '连接状态更新'}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
      )}</div>
      <div className="native-pages"><button disabled={!previous.length} onClick={() => { setAfter(previous.at(-1)!); setPrevious(values => values.slice(0, -1)); }}>上一页记录</button><button disabled={!more} onClick={() => { setPrevious(values => [...values, after]); setAfter(next); }}>下一页记录</button></div>
      <div className="native-compose"><label>发送给原生会话<textarea aria-label="原生会话消息" maxLength={32768} value={draft} disabled={busy} onChange={e => setDrafts(old => ({ ...old, [active]: e.target.value }))} /></label>
      <div className="native-actions"><button disabled={busy || !current.connected || current.pending || !draft.trim()} onClick={() => void send()}>发送到同一会话</button>
      <button disabled={busy || !current.connected || current.pending} onClick={() => void close()}>关闭空闲连接，保留历史</button></div></div>
    </>}
  </section>;
}
