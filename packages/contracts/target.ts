import {z} from 'zod';
import {rangeDimensions} from './index.ts';
const common={windowId:z.string().min(1).max(200).optional()};
export const targetSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('excel'),sheet:z.string().min(1).max(150),range:z.string().min(1).max(30)}).strict(),
  z.object({...common,kind:z.literal('word'),text:z.string().min(1).max(2000),match:z.number().int().min(1).max(20).optional()}).strict(),
  z.object({...common,kind:z.literal('powerpoint'),slideId:z.string().regex(/^\d+$/).optional(),slideIndex:z.number().int().min(1).max(1000).optional(),shapeId:z.string().regex(/^\d+$/),textStart:z.number().int().min(1).optional(),textLength:z.number().int().min(1).max(2000).optional()}).strict(),
]).superRefine((v,c)=>{
  if(v.kind==='excel')try{rangeDimensions(v.range);}catch{c.addIssue({code:'custom',message:'Use a bounded Excel address of at most 1000 cells.'});}
  if(v.kind==='powerpoint'){
    if(Boolean(v.slideId)===(v.slideIndex!==undefined))c.addIssue({code:'custom',message:'Supply exactly one slideId or slideIndex.'});
    if((v.textStart===undefined)!==(v.textLength===undefined))c.addIssue({code:'custom',message:'Text start and length must be supplied together.'});
  }
});
