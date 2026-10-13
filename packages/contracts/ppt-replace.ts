import {z} from 'zod';
import {selectionSchema} from './selection.ts';
import {planTextSplices} from './word-replace.ts';
export const pptReplaceSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),selection:selectionSchema,text:z.string().min(1).max(2000)}).strict().superRefine((value,context)=>{
  const s=value.selection;
  if(s.kind!=='powerpoint'||s.shapeIds.length!==1||!s.replacementRevision||s.textLength===0)context.addIssue({code:'custom',message:'Capture one supported text range with a replacement revision.'});
  if(/[\u0000-\u001f\u2028\u2029]/.test(value.text))context.addIssue({code:'custom',message:'Structural text and paragraph changes require a separate operation.'});
});
export function planPptTextEdit(state:{text:string;start:number;length:number;profiles:unknown[]},text:string){
  const {start,length}=state,base=start-1,end=base+length;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||base<0||length<1||end>state.text.length||state.profiles.length!==state.text.length||!text.length||text.length>2000||state.text.length-length+text.length>2000||/[\u0000-\u001f\u2028\u2029]/.test(text))throw Error('PPT_TEXT_RANGE');
  const selected=state.text.slice(base,end);
  if(/[\u0000-\u001f\u2028\u2029]/.test(selected)||/[\uDC00-\uDFFF]/.test(selected[0])||/[\uD800-\uDBFF]/.test(selected.at(-1)!))throw Error('PPT_STRUCTURAL_RANGE');
  const profiles=structuredClone(state.profiles),origins=state.profiles.map((_,i)=>i),splices=planTextSplices(selected,text).map(edit=>{
    const source=Math.min(base+edit.start,end-1),profile=structuredClone(state.profiles[source]);
    profiles.splice(base+edit.start,edit.end-edit.start,...Array.from({length:edit.text.length},()=>structuredClone(profile)));
    origins.splice(base+edit.start,edit.end-edit.start,...Array.from({length:edit.text.length},()=>source));
    return {...edit,profile};
  });
  return {splices,expectedText:state.text.slice(0,base)+text+state.text.slice(end),expectedProfiles:profiles,expectedProfileOrigins:origins};
}
