import {useEffect,useState} from 'react';
import type {Api} from './Product.tsx';
import {compactPptAppearance} from '../../../packages/contracts/tool-results.ts';
const statuses:Record<string,string>={applied:'已验证修改',failed:'未完成',conflict:'冲突，未覆盖',unknown:'结果待核对',running:'执行中',queued:'等待执行'};
function number(value:unknown){return typeof value==='number'&&Number.isFinite(value)?String(Math.round(value*100)/100):'未回读';}
function Appearance({label,value}:{label:string;value:any}){
  if(!value)return null;
  if(value.mode==='none')return <span>{label}：无</span>;
  const color=typeof value.color==='string'&&/^#[a-fA-F0-9]{6}$/.test(value.color)?value.color:undefined;
  return <span>{label}：{color&&<span className="native-color-swatch" style={{background:color}} aria-hidden="true"/>}{color??'未回读'}{value.width!==undefined&&` · ${number(value.width)} 磅`}{typeof value.transparency==='number'&&` · 透明度 ${number(value.transparency*100)}%`}</span>;
}
export function NativeLayoutSummary({kind,receipt,recovered}:{kind:string;receipt:any;recovered:boolean}){
  if(kind==='excel.chart.layout'&&receipt?.format)return <NativeChartSummary receipt={receipt} recovered={recovered}/>;
  if(!['ppt.layout','ppt.layout.batch'].includes(kind)||!receipt)return null;
  const steps=kind==='ppt.layout.batch'?receipt.steps??[]:[{...receipt,shapeId:receipt.shapeId??'固定对象',appearance:compactPptAppearance(receipt.appearance)}];
  return <section className="native-layout-summary" aria-label="PPT 修改摘要"><p className="muted">{recovered?'已恢复；以下保留本次修改时的回读记录。':'本次操作后的实际回读（历史记录）'}</p>{steps.map((step:any,i:number)=><div key={step.operationId??i} className="native-object-result"><strong>对象 {step.shapeId??i+1} · {step.verified?'已验证修改':statuses[step.status]??'待核对'}</strong>{step.geometry?<span>位置：左 {number(step.geometry.left)}、上 {number(step.geometry.top)} 磅；尺寸：{number(step.geometry.width)} × {number(step.geometry.height)} 磅</span>:<span>未取得写入后的实际位置；不把请求值当作结果。</span>}<Appearance label="填充" value={step.appearance?.fill}/><Appearance label="边框" value={step.appearance?.outline}/>{step.textFrame&&<span>文本适应：{({0:'保持尺寸和字号',1:'自动扩大文本框',2:'缩小文字以适应'} as Record<number,string>)[step.textFrame.AutoSize]??'待核对'}</span>}{step.minimumFontSize!==undefined&&<span>实际最小字号：{number(step.minimumFontSize)} 磅{step.minimumFontSize<10?'，请检查可读性。':''}</span>}{step.layoutCheck?.mayOverflow&&<span>原生边界提示可能溢出，请检查成品。</span>}{step.slideCheck?.mayClip&&<span>对象边界可能越过幻灯片画布，内容可能被裁切；请检查位置和尺寸。</span>}</div>)}</section>;
}
export function NativeChartSummary({receipt,recovered}:{receipt:any;recovered:boolean}){
  const axis=receipt.valueAxis,format=receipt.format??{},geometry=receipt.geometry;
  const scale=(key:string)=>axis?.[key+'Auto']?`自动（回读 ${number(axis[key])}）`:number(axis?.[key]);
  return <section className="native-layout-summary" aria-label="Excel 图表修改摘要"><p className="muted">{recovered?'已恢复；以下保留本次修改时的回读记录。':'本次操作后的实际回读（历史记录）'}</p><div className="native-object-result"><strong>固定图表 · {receipt.verified?'已验证修改':statuses[receipt.status]??'待核对'}</strong><span>类型：{({51:'柱形',57:'条形',4:'折线',5:'饼图'} as Record<number,string>)[format.type]??'未回读'}；标题：{format.hasTitle?format.title:'无'}；图例：{typeof format.hasLegend==='boolean'?(format.hasLegend?'显示':'隐藏'):'未回读'}；样式：{number(format.style)}</span>{geometry&&<span>位置：左 {number(geometry.left)}、上 {number(geometry.top)} 磅；尺寸：{number(geometry.width)} × {number(geometry.height)} 磅</span>}{axis&&<><span>主数值轴：最小 {scale('minimum')}，最大 {scale('maximum')}</span><span>主要间隔：{scale('majorUnit')}；次要间隔：{scale('minorUnit')}</span><span>刻度数字格式：{axis.numberFormatLinked?'跟随源数据':axis.numberFormat??'未回读'}</span></>}</div></section>;
}
export function NativeOperationDetails({api,linkId,operationId,version}:{api:Api;linkId:string;operationId:string;version:string}){
  const [open,setOpen]=useState(false),[value,setValue]=useState<any>(null),[error,setError]=useState('');
  useEffect(()=>{
    let current=true;setValue(null);setError('');if(!open)return;
    void api(`/api/native-sessions/${linkId}/operations?operationId=${encodeURIComponent(operationId)}`).then(data=>{if(current)setValue(data);}).catch(e=>{if(current)setError(e instanceof Error?e.message:'读取完整记录失败');});
    return()=>{current=false;};
  },[open,api,linkId,operationId,version]);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>查看修改与验证记录</summary>{open&&(error?<p role="alert">{error}</p>:value?<pre>{JSON.stringify({operationId:value.id,payload:value.payload,result:value.result,recovery:value.recovery},null,2)}</pre>:<p className="muted">读取完整记录…</p>)}</details>;
}
