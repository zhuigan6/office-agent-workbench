import React,{useEffect,useRef,useState} from 'react';
import type {AgentOption} from '../../../packages/contracts/agent-options.ts';
export function AgentSettings({conversation,api}:{conversation:string;api:(route:string,body?:unknown)=>Promise<any>}){
  const [options,setOptions]=useState<AgentOption[]|null>(null),[draft,setDraft]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const mounted=useRef(true),requesting=useRef(false);
  useEffect(()=>()=>{mounted.current=false;},[]);
  async function run(option?:AgentOption){
    if(requesting.current)return;requesting.current=true;setBusy(true);setError('');setConfirmed(false);
    try{
      const result=await api(`/api/conversations/${conversation}/${option?'option':'runtime-options'}`,option?{optionId:option.id,value:draft[option.id]}:{});
      if(mounted.current){setOptions(result.options);setDraft({});setConfirmed(result.confirmed===true);}
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'无法确认智能体设置，请刷新实际值。');}
    finally{requesting.current=false;if(mounted.current)setBusy(false);}
  }
  return <section className="agent-settings"><h3>模型与思考</h3><p>读取当前智能体实际提供的选项；可能唤醒其进程，不发送模型任务。仅修改这个会话，不修改全局登录或权限模式。</p>
    <button disabled={busy} onClick={()=>void run()}>{busy?'正在确认…':'读取 / 刷新实际选项'}</button>
    {options?.length===0&&<p>当前智能体未提供可编辑的模型或思考选项；请使用其自身设置，或新建任务选择模型。</p>}
    {options?.map(option=>{const value=draft[option.id]??option.currentValue??'';return <div key={option.id}>
      <label>{option.category==='model'?'模型':'思考强度'}<select aria-label={option.category==='model'?'会话实际模型':'会话思考强度'} value={value} disabled={busy} onChange={e=>setDraft(d=>({...d,[option.id]:e.target.value}))}>
        {!option.choices.some(c=>c.value===value)&&<option value={value} disabled>{value||'上游未报告当前值'}</option>}
        {option.choices.map(choice=><option key={choice.value} value={choice.value}>{choice.name}</option>)}
      </select></label><button disabled={busy||!draft[option.id]||draft[option.id]===option.currentValue} onClick={()=>void run(option)}>应用{option.category==='model'?'模型':'思考强度'}</button>
    </div>;})}
    {confirmed&&<p role="status">智能体已确认新设置。</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
