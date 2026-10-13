import {z} from 'zod';
import {rangeDimensions} from './index.ts';
const common={windowId:z.string().min(1).max(200).optional()};
export const targetSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('excel'),sheet:z.string().min(1).max(150),range:z.string().min(1).max(30).optional(),chartName:z.string().min(1).max(255).optional()}).strict(),
  z.object({...common,kind:z.literal('word'),text:z.string().min(1).max(2000).optional(),match:z.number().int().min(1).max(20).optional(),tableIndex:z.number().int().min(1).max(1000).optional(),row:z.number().int().min(1).max(20).optional(),column:z.number().int().min(1).max(20).optional()}).strict(),
  z.object({...common,kind:z.literal('powerpoint'),slideId:z.string().regex(/^\d+$/).optional(),slideIndex:z.number().int().min(1).max(1000).optional(),shapeId:z.string().regex(/^\d+$/),textStart:z.number().int().min(1).optional(),textLength:z.number().int().min(1).max(2000).optional()}).strict(),
]).superRefine((v,c)=>{
  if(v.kind==='excel'){
    if((v.range===undefined)===(v.chartName===undefined))c.addIssue({code:'custom',message:'Choose exactly one cell range or embedded chartName.'});
    if(v.range!==undefined)try{rangeDimensions(v.range);}catch{c.addIssue({code:'custom',message:'Use a bounded Excel address of at most 1000 cells.'});}
  }
  if(v.kind==='word'&&!(v.text!==undefined&&v.tableIndex===undefined&&v.row===undefined&&v.column===undefined||v.text===undefined&&v.match===undefined&&v.tableIndex!==undefined&&((v.row===undefined&&v.column===undefined)||(v.row!==undefined&&v.column!==undefined))))c.addIssue({code:'custom',message:'Choose exact text, one whole tableIndex, or a complete tableIndex/row/column cell target, not a mixture.'});
  if(v.kind==='powerpoint'){
    if(Boolean(v.slideId)===(v.slideIndex!==undefined))c.addIssue({code:'custom',message:'Supply exactly one slideId or slideIndex.'});
    if((v.textStart===undefined)!==(v.textLength===undefined))c.addIssue({code:'custom',message:'Text start and length must be supplied together.'});
  }
});
