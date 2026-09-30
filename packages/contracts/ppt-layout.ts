import {z} from 'zod';
import {selectionSchema} from './selection.ts';
export const geometrySchema=z.object({left:z.number().min(-10000).max(10000).optional(),top:z.number().min(-10000).max(10000).optional(),width:z.number().min(1).max(10000).optional(),height:z.number().min(1).max(10000).optional(),rotation:z.number().min(0).max(360).optional()}).strict().refine(v=>Object.keys(v).length>0,'Supply at least one geometry property.');
export const pptLayoutSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,geometry:geometrySchema}).strict().superRefine((v,c)=>{
  if(v.selection.kind!=='powerpoint'||v.selection.shapeIds.length!==1||!v.selection.layoutRevision)c.addIssue({code:'custom',message:'Capture one PowerPoint shape with a layout revision.'});
});
