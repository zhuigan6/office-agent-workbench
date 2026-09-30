import React,{useState,useEffect} from 'react';
import {AgentSettings} from './AgentSettings.tsx';
export function RuntimePanel({conversation,api,prepare}:{conversation:string;api:(route:string,data?:unknown)=>Promise<any>;prepare:(text:string)=>void}){
  const [open,setOpen]=useState(false),[data,setData]=useState<any>(null),[error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let alive=true;setData(null);setError('');
    if(open&&conversation)void api(`/api/conversations/${conversation}/features`).then(result=>{if(alive)setData(result);}).catch(()=>{if(alive)setError('暂时无法读取智能体统计。');});
    return()=>{alive=false;};
  },[open,conversation,revision]);
  if(!conversation)return null;
  const u=data?.usage,n=(v:number|null|undefined)=>typeof v==='number'?v.toLocaleString():'未报告';
  const compact=data?.commands?.find((c:any)=>c.name.replace(/^\//,'')==='compact');
  return <details className="runtime-panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>上下文与用量</summary>
    {open&&<div><button onClick={()=>setRevision(r=>r+1)}>刷新统计</button>{error&&<p role="alert">{error}</p>}
      {!data&&!error?<p>正在读取…</p>:<>
        <dl><dt>上下文</dt><dd>{n(u?.contextUsed)} / {n(u?.contextSize)}</dd><dt>输入 / 输出 Token</dt><dd>{n(u?.inputTokens)} / {n(u?.outputTokens)}</dd><dt>缓存读取 / 写入</dt><dd>{n(u?.cachedReadTokens)} / {n(u?.cachedWriteTokens)}</dd><dt>智能体报告费用</dt><dd>{u?.amount!=null&&u.currency?`${u.amount.toFixed(6)} ${u.currency}`:'未报告'}</dd></dl>
        <p>统计来自当前智能体，计量口径可能不同；不是供应商账单，也不表示所有历史请求的总费用。原始聊天不会因界面分页而删除。</p>
        {compact?<button onClick={()=>prepare('/compact ')}>准备压缩命令</button>:<p>当前智能体未提供可验证的压缩命令；不通过清空聊天伪装压缩。</p>}
        {compact&&<p>命令先放入输入框，由你确认发送；压缩由智能体自身执行。命令被接受或出现空回合提示，不代表压缩已经成功；请结合智能体反馈与刷新后的用量判断。</p>}
        <AgentSettings key={conversation} conversation={conversation} api={api}/>
      </>}
    </div>}
  </details>;
}
