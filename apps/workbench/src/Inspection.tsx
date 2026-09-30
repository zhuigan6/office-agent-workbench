import React from 'react';
export function inspectionNodes(value:any):any[]|null {
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}
  const rows=value?.data?.results;
  return Array.isArray(rows)&&rows.every(v=>v&&typeof v.path==='string'&&typeof v.type==='string')?rows:null;
}
const labels:Record<string,string>={formula:'公式',computedValue:'计算值',cachedValue:'缓存值',numberformat:'数字格式',rows:'行数',cols:'列数',width:'宽度',height:'高度',x:'横向位置',y:'纵向位置',size:'字号',color:'颜色',bold:'加粗',layout:'布局',chartType:'图表类型'};
function Node({node,depth=0}:{node:any;depth?:number}){
  const children=Array.isArray(node.children)?node.children:[],format=node.format||{};
  return <article className="inspection-node"><header><code>{node.path}</code><span>{node.type}</span></header>
    {typeof node.text==='string'&&<p className="inspection-text">{node.text}</p>}
    {node.style&&<p className="muted">样式：{String(node.style)}</p>}
    <dl>{Object.entries(labels).filter(([key])=>format[key]!==undefined).map(([key,label])=><React.Fragment key={key}><dt>{label}</dt><dd>{typeof format[key]==='object'?JSON.stringify(format[key]):String(format[key])}</dd></React.Fragment>)}</dl>
    {children.length>0&&depth<2&&<details><summary>子元素 · {children.length}</summary>{children.slice(0,20).map((child:any,i:number)=><Node key={child.path||i} node={child} depth={depth+1}/>)}{children.length>20&&<p className="muted">仅展示前 20 项，请按对象路径继续查询。</p>}</details>}
    <details><summary>完整对象属性</summary><pre>{JSON.stringify({format,childCount:node.childCount},null,2)}</pre></details>
  </article>;
}
export function Inspection({nodes}:{nodes:any[]}){return <div>{nodes.slice(0,50).map((node,i)=><Node key={node.path||i} node={node}/>)}{nodes.length>50&&<p>仅显示前 50 个对象，请缩小查询范围。</p>}</div>;}
