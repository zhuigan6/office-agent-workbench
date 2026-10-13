import {z} from 'zod';
import {selectionSchema} from './selection.ts';
export const geometrySchema=z.object({left:z.number().min(-10000).max(10000).optional(),top:z.number().min(-10000).max(10000).optional(),width:z.number().min(1).max(10000).optional(),height:z.number().min(1).max(10000).optional(),rotation:z.number().min(0).max(360).optional()}).strict().refine(v=>Object.keys(v).length>0,'Supply at least one geometry property.');
export const pptTextFrameSchema=z.object({autoFit:z.enum(['none','text','shape']).optional(),verticalAnchor:z.enum(['top','middle','bottom']).optional(),wordWrap:z.boolean().optional(),marginLeft:z.number().finite().min(0).max(1000).optional(),marginRight:z.number().finite().min(0).max(1000).optional(),marginTop:z.number().finite().min(0).max(1000).optional(),marginBottom:z.number().finite().min(0).max(1000).optional()}).strict().refine(v=>Object.keys(v).length>0,'Supply a text-frame property.');
const color=z.string().regex(/^#[a-fA-F0-9]{6}$/),transparency=z.number().finite().min(0).max(1);
export const pptAppearanceSchema=z.object({
  fill:z.discriminatedUnion('mode',[z.object({mode:z.literal('none')}).strict(),z.object({mode:z.literal('solid'),color,transparency:transparency.optional()}).strict()]).optional(),
  outline:z.discriminatedUnion('mode',[z.object({mode:z.literal('none')}).strict(),z.object({mode:z.literal('solid'),color,width:z.number().finite().min(0.25).max(100).optional(),transparency:transparency.optional()}).strict()]).optional(),
}).strict().refine(v=>Object.keys(v).length>0,'Supply fill and/or outline properties.');
export const pptLayoutEditSchema=z.object({shapeId:z.string().min(1).max(100),geometry:geometrySchema.optional(),appearance:pptAppearanceSchema.optional(),textFrame:pptTextFrameSchema.optional()}).strict().refine(v=>Boolean(v.geometry||v.appearance||v.textFrame),'Supply geometry, appearance and/or text-frame properties.');
export const pptLayoutSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,geometry:geometrySchema.optional(),textFrame:pptTextFrameSchema.optional(),appearance:pptAppearanceSchema.optional()}).strict().superRefine((v,c)=>{
  if(v.selection.kind!=='powerpoint'||v.selection.shapeIds.length!==1||!v.selection.layoutRevision)c.addIssue({code:'custom',message:'Capture one PowerPoint shape with a layout revision.'});
  if(!v.geometry&&!v.textFrame&&!v.appearance)c.addIssue({code:'custom',message:'Supply geometry, text-frame and/or appearance properties.'});
  if(v.appearance&&(v.selection.kind!=='powerpoint'||v.selection.appearanceProfileVersion!==1||v.selection.textStart!==undefined))c.addIssue({code:'custom',message:'Appearance editing requires a versioned whole-object capture, not a text citation.'});
  if(v.textFrame&&(v.selection.kind!=='powerpoint'||v.selection.frameProfileVersion!==1||!v.selection.replacementRevision))c.addIssue({code:'custom',message:'Text-frame editing requires a versioned complete text-shape capture.'});
});
