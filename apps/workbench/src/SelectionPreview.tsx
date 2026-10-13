import React,{useEffect,useRef,useState} from 'react';
import type {Api} from './Product.tsx';
import type {SelectionTicket} from '../../../packages/document-workspace/selections.ts';
import {selectionPreviewText} from './selection-display.ts';

export function SelectionPreview({conversation,enabled,api,onReference,referenceId,endpoint}:{conversation:string;enabled:boolean;api:Api;onReference:(id:string|null)=>void;referenceId?:string;endpoint?:string}){
  const [ticket,setTicket]=useState<SelectionTicket|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setTicket(null);setError('');setPending(false);return()=>{generation.current++;};},[conversation]);
  async function capture(){
    const current=++generation.current;setPending(true);setTicket(null);setError('');onReference(null);
    try{const result=await api(endpoint??'/api/native/selection',{conversationId:conversation});if(current===generation.current)setTicket(result);}
    catch(e){if(current===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(current===generation.current)setPending(false);}
  }
  const selection=ticket?.selection;
  const preview=selection?selectionPreviewText(selection):'';
  const canReference=selection&&(selection.kind==='excel-chart'||selection.kind==='excel'||(selection.kind==='word'&&(Boolean(selection.table)||selection.end-selection.start<=2000))||(selection.kind==='powerpoint'&&((selection.shapeIds.length===1&&(selection.textLength!==0||Boolean(selection.layoutRevision)))||Boolean(selection.shapeLayouts))));
  const target=!selection?'':selection.kind==='excel-chart'?`${selection.chart.sheet} · 图表 ${selection.chart.name}`:selection.kind==='excel'?`${selection.sheet}!${selection.range}`:selection.kind==='word'?`${selection.table?`完整表格 ${selection.table.tableIndex} · ${selection.table.rows} 行 × ${selection.table.columns} 列 · `:selection.cell?`表格 ${selection.cell.tableIndex} · 第 ${selection.cell.row} 行第 ${selection.cell.column} 列 · `:'正文位置 '}${selection.start}–${selection.end}${selection.start===selection.end?'（光标）':''}`:selection.kind==='powerpoint-slides'?`幻灯片 ID：${selection.slideIds.join('、')}`:`幻灯片 ${selection.slideId} · 对象 ${selection.shapeIds.join('、')}`;
  return <section className="document-details" aria-label="当前 Office 选区">
    <button type="button" disabled={!conversation||!enabled||pending} onClick={()=>void capture()}>{pending?'读取选区…':'预览 Office 当前选区'}</button>
    {selection?.kind==='excel'&&<p className="notice">普通单元格范围可组合粗体、斜体、字体颜色、纯色填充和水平／垂直对齐。先读当前外观，再按版本修改；不改数据、字号、换行或行高。条件格式、合并、混合字符格式等另行处理，不能扩大这条引用。</p>}
    {selection?.kind==='excel'&&!selection.table&&<p className="notice">带有唯一文本表头的普通数据范围可创建原生 Excel 数据表，一次组合名称、样式和条纹。不插入表头、不改数据和公式；验证后这块相同范围可接续表格操作。恢复只撤销本次新表并还原原有格式，发现后续引用或修改时不会强行撤销。</p>}
    {selection?.kind==='excel'&&selection.table&&<p className="notice">也可一次追加多列名称、数值／显式公式和数字格式，仅使用表格右侧已核对的空白常规区域。不插入整列、不移动旁边内容；验证后同一引用接续扩展后的表格。存在后续编辑或引用时，恢复不会强行缩表。</p>}
    {selection?.kind==='excel'&&<p className="notice">也可明确要求以这块数据创建原生图表，一次组合类型、标题、图例、样式和布局；源单元格不变。创建后的图表是新对象，此引用不会自动转向新图表。</p>}
    {selection?.kind==='excel-chart'&&<p className="notice">此引用固定一张嵌入式图表；{selection.chart.formatRevision?'已取得格式版本，可一次组合修改位置、尺寸、支持的类型、文字标题、图例和内置样式，以及已有主数值轴的线性刻度、间隔与数字格式。':'此旧引用仅支持位置和尺寸；标题、类型、样式或坐标轴修改需要重新明确取得格式引用。'}位置和尺寸单位为磅，不改数据源；饼图、对数轴、次坐标轴与分类轴不在本次支持范围。点击别处不会改变此目标；只选单元格不能扩大为图表修改。</p>}
    {selection?.kind==='powerpoint'&&selection.replacementRevision&&<p className="notice">完整段落可通过同一次格式操作组合字体、对齐、段前／段后间距和行距。半句选区只能改对应文字格式，不能扩大为整段排版；未选段落保持不变。带自动适应的普通文本框会核对实际字号与原始定义，不把缩小后的显示字号当成原始字号。</p>}
    {selection?.kind==='powerpoint'&&selection.appearanceProfileVersion===1&&selection.textStart===undefined&&<p className="notice">已取得完整对象外观：可一次组合位置、尺寸、纯色／无填充、纯色／无边框和透明度，也可组合已支持的文本框适应与内边距。修改直接显示在 PowerPoint 中；恢复核对实际外观和原有主题颜色，不承诺隐藏定义或原文件字节相同。渐变、图片、组合和母版另行处理；部分文字引用不能扩大成整对象修改。</p>}
    {selection?.kind==='powerpoint'&&selection.shapeLayouts&&<p className="notice">已固定 {selection.shapeLayouts.length} 个对象，其中 {selection.shapeLayouts.filter(s=>s.appearanceProfileVersion===1).length} 个有完整外观快照，{selection.shapeLayouts.filter(s=>s.frameProfileVersion===1&&s.replacementRevision).length} 个有完整文本框快照。可一次批量组合位置、尺寸、支持对象的填充／边框与文本框适应／内边距；实际尺寸和字号由 Office 回读，不假定请求值就是最终值。每一步单独记录，整批不是原子事务；失败时检查实际已完成步骤，不重发整批。</p>}
    {selection?.kind==='excel'&&selection.table&&<p className="notice">完整 Excel 数据表：{selection.table.name}。可以组合样式/条纹或向末尾已核对的空白常规区域追加记录与显式公式，不移动周围单元格。这里显示最初捕获范围；追加后以已验证操作结果的范围为准。只选部分单元格不能扩大范围；直接修改单元格数据或恢复后，应重新明确引用。</p>}
    <p className="muted">先在当前任务的 Office 文档中选择内容，再点击读取。Excel 支持数值、公式和数字格式；Word 支持字符格式、整段样式/排版、单段文字替换与正文/普通单元格光标插入；完整选中1–20段普通正文时可一次批量改写，保持段数和段落格式。完整选中普通表格可引用整表，批量编辑单元格、设置整表排版或在末尾追加1–10行；只选一格不能扩大范围。PPT 普通单文本框支持字符格式及限定文字替换；富快照支持已安装字体和 RGB 颜色，非组合对象支持位置、尺寸、旋转和2–20个对象批量布局。</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {selection&&<div role="status"><strong>{target}</strong><pre style={{whiteSpace:'pre-wrap',maxHeight:160,overflow:'auto'}}>{preview||(selection.kind==='word'?'当前为光标位置，未选中文字。':'对象没有可预览的文字。')}</pre>{selection.kind==='word'&&(selection.table?<small>此引用固定整张普通表格；可批量编辑表内单元格、设置排版或追加行，不可替换成另一张表。</small>:selection.preview.includes('\r')&&<small>此引用包含段落边界；批量改写要求完整普通段落，不增删段落。</small>)}{selection.kind==='powerpoint'&&selection.shapeIds.length===1&&<small>{selection.replacementRevision?'已取得固定文字替换快照；不支持换段、空字符串或复杂文字效果。':'本选区未取得文字替换快照，仍可使用适用的格式或布局操作。'}</small>}<small>此快照不会随 Office 选区变化而改变；刷新页面后需重新引用。</small>{canReference&&<button type="button" disabled={!enabled} onClick={()=>onReference(referenceId===ticket!.id?null:ticket!.id)}>{referenceId===ticket!.id?'取消本条消息的选区引用':'将此选区引用到下一条消息'}</button>}</div>}
  </section>;
}
