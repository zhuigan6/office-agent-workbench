import React,{useEffect,useRef,useState} from 'react';
import type {Api} from './Product.tsx';
import type {SelectionTicket} from '../../../packages/document-workspace/selections.ts';

export function SelectionPreview({conversation,enabled,api,onReference,referenceId}:{conversation:string;enabled:boolean;api:Api;onReference:(id:string|null)=>void;referenceId?:string}){
  const [ticket,setTicket]=useState<SelectionTicket|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setTicket(null);setError('');setPending(false);return()=>{generation.current++;};},[conversation]);
  async function capture(){
    const current=++generation.current;setPending(true);setTicket(null);setError('');onReference(null);
    try{const result=await api('/api/native/selection',{conversationId:conversation});if(current===generation.current)setTicket(result);}
    catch(e){if(current===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(current===generation.current)setPending(false);}
  }
  const selection=ticket?.selection;
  const target=!selection?'':selection.kind==='excel'?`${selection.sheet}!${selection.range}`:selection.kind==='word'?`正文位置 ${selection.start}–${selection.end}${selection.start===selection.end?'（光标）':''}`:selection.kind==='powerpoint-slides'?`幻灯片 ID：${selection.slideIds.join('、')}`:`幻灯片 ${selection.slideId} · 对象 ${selection.shapeIds.join('、')}`;
  return <section className="document-details" aria-label="当前 Office 选区">
    <button type="button" disabled={!conversation||!enabled||pending} onClick={()=>void capture()}>{pending?'读取选区…':'预览 Office 当前选区'}</button>
    <p className="muted">先在当前任务的 Office 文档中选择内容，再点击读取。Excel 支持数值、公式和数字格式；Word 支持字符格式和单段文字替换（恢复会核对整段）；PPT 单个文本框支持字符格式，单个非组合对象支持位置、尺寸和旋转。</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {selection&&<div role="status"><strong>{target}</strong><pre style={{whiteSpace:'pre-wrap',maxHeight:160,overflow:'auto'}}>{selection.preview||(selection.kind==='word'?'当前为光标位置，未选中文字。':'对象没有可预览的文字。')}</pre><small>此快照不会随 Office 选区变化而改变；刷新页面后需重新引用。</small>{(selection.kind==='excel'||(selection.kind==='word'&&selection.end>selection.start&&selection.end-selection.start<=2000)||(selection.kind==='powerpoint'&&selection.shapeIds.length===1&&(selection.textLength!==0||Boolean(selection.layoutRevision))))&&<button type="button" disabled={!enabled} onClick={()=>onReference(referenceId===ticket!.id?null:ticket!.id)}>{referenceId===ticket!.id?'取消本条消息的选区引用':'将此选区引用到下一条消息'}</button>}</div>}
  </section>;
}
