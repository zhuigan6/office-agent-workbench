import type { Operation } from './index.ts';

export function compactPptAppearance(state:any){
  if(!state)return undefined;
  const compact=(part:any)=>{
    if(part?.visible===0)return {mode:'none'};
    const rgb=part?.color?.rgb;if(part?.visible!==-1||!Number.isInteger(rgb)||rgb<0||rgb>0xffffff)return undefined;
    return {mode:'solid',color:'#'+[rgb&255,(rgb>>>8)&255,(rgb>>>16)&255].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase(),transparency:part.transparency,...(part.weight!==undefined?{width:part.weight}:{})};
  };
  return {fill:compact(state.fill),outline:compact(state.outline)};
}

// Full before/after matrices remain in the local operation journal, not every model turn.
export function writeToolResult(operation: Operation) {
  const result = operation.result as any;
  const payload = operation.payload as any;
  return {
    operationId: operation.id,
    status: operation.status,
    sheet: payload?.sheet,
    range: payload?.range,
    verified: operation.status === 'applied' && result?.verified === true,
    revision: result?.revision,
    code: result?.code,
    message: result?.message,
    ...(operation.kind==='word.table.layout'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,reference:result?.after?.reference,...(result?.after?.widths?{columnWidths:result.after.widths.columns,allowAutoFit:result.after.widths.allowAutoFit}:{}),...(result?.after?.borders?{borders:result.after.borders.table}:{})}:{}),
    ...(operation.kind==='excel.table.columns'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,range:result?.after?.reference?.range,rows:result?.after?.shape?.rows,columns:result?.after?.shape?.columns}:{}),
    ...(operation.kind==='excel.table.create'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,...(result?.after?.reference?{table:{reference:result.after.reference,shape:result.after.shape,properties:result.after.properties}}:{}),...(result?.createdReference?{createdReference:result.createdReference}:{})}:{}),
    ...(operation.kind==='ppt.format'&&result?.layoutCheck?{layoutCheck:result.layoutCheck}:{}),
    ...(operation.kind==='ppt.format'&&result?.autoFit?{autoFit:result.autoFit,minimumFontSize:result.minimumFontSize}:{}),
    ...(operation.kind==='excel.chart.layout'&&result?.after?.format?{format:result.after.format,geometry:result.after.geometry,...(result.after.valueAxis?{valueAxis:result.after.valueAxis}:{}),restoreAvailable:operation.status==='applied'&&result?.verified===true,titleLanguageDetected:result.titleLanguageDetected===true,titleDeclarationsNormalized:result.titleDeclarationsNormalized===true}:{}),
    ...(operation.kind==='ppt.replace'&&result?.autoFit?{autoFit:result.autoFit,minimumFontSize:result.minimumFontSize,layoutCheck:result.layoutCheck}:{}),
    ...(operation.kind==='ppt.layout'&&result?.after?.state?{shapeId:result.after.state.shapeId,geometry:result.after.state.geometry,textFrame:result.after.state.textFrame,appearance:result.after.state.appearance,appearanceRecovery:result.appearanceRecovery,automaticGeometry:result.automaticGeometry,minimumFontSize:result.minimumFontSize,layoutCheck:result.layoutCheck,slideCheck:result.slideCheck,restoreAvailable:operation.status==='applied'&&result?.verified===true}:{}),
    ...(operation.kind==='excel.range.format'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,reference:result?.after?.reference,sheet:payload.reference?.sheet,range:payload.reference?.range}:{}),
    ...(operation.kind==='excel.chart.create'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,
      ...(result?.after?.reference?{chart:{reference:result.after.reference,geometry:result.after.geometry,type:result.after.content?.type,title:result.after.content?.title},source:{sheet:payload.source?.sheet,range:payload.source?.range}}:{}),
      ...(result?.createdReference?{createdReference:result.createdReference}:{}),
    }:{}),
    ...(operation.kind==='excel.table.rows'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,range:result?.after?.reference?.range,rows:result?.after?.shape?.rows,columns:result?.after?.shape?.columns}:{}),
    ...(operation.kind==='word.table.rows'?{atomic:false,restoreAvailable:operation.status==='applied'&&result?.verified===true,rows:result?.after?.reference?.rows,columns:result?.after?.reference?.columns}:{}),
    ...(['ppt.layout.batch','word.table.batch','word.paragraph.batch'].includes(operation.kind)?{atomic:false,restoreAvailable:result?.restoreAvailable===true,
      steps:(result?.children??[]).slice(0,operation.kind==='word.table.batch'?40:20).map((child:Operation)=>({operationId:child.id,status:child.status,verified:child.status==='applied'&&(child.result as any)?.verified===true,...(child.kind==='ppt.layout'?{shapeId:(child.payload as any)?.selection?.shapeIds?.[0],geometry:(child.result as any)?.after?.state?.geometry,appearance:compactPptAppearance((child.result as any)?.after?.state?.appearance),textFrame:(child.result as any)?.after?.state?.textFrame,automaticGeometry:(child.result as any)?.automaticGeometry,minimumFontSize:(child.result as any)?.minimumFontSize,layoutCheck:(child.result as any)?.layoutCheck,slideCheck:(child.result as any)?.slideCheck}:{})}))}:{}),
    ...(['ppt.layout.batch','word.table.batch','word.paragraph.batch'].includes(operation.kind)&&operation.status==='failed'?{instruction:'Batch stopped; inspect the recorded steps. Only verified applied steps may be restored. Do not replay the whole batch.'}:{}),
    ...(operation.status === 'conflict' ? { instruction: 'Reread the target before deciding a new operation; a frozen selection requires a new explicit reference.' } : {}),
    ...(operation.status === 'unknown' ? { instruction: 'Inspect the current target. Do not blindly retry.' } : {}),
  };
}
