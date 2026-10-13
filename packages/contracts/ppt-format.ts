import {z} from 'zod';
import {selectionSchema} from './selection.ts';
export const pptFontSchema=z.object({bold:z.boolean().optional(),italic:z.boolean().optional(),size:z.number().min(1).max(400).multipleOf(0.5).optional(),name:z.string().min(1).max(128).refine(v=>v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v)).optional(),color:z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()}).strict().refine(v=>Object.keys(v).length>0,'At least one font property is required.');
const relativeSize=z.number().finite().min(0.25).max(4);
export const pptBulletSchema=z.union([
  z.object({type:z.literal('none')}).strict(),
  z.object({type:z.literal('character'),character:z.number().int().min(32).max(65535).refine(v=>v<55296||v>57343,'Use one non-surrogate BMP character code.'),relativeSize:relativeSize.optional()}).strict(),
  z.object({type:z.literal('numbered'),style:z.number().int().min(0).max(40),start:z.number().int().min(1).max(32767),relativeSize:relativeSize.optional()}).strict()
]);
export const pptParagraphSchema=z.object({alignment:z.enum(['left','center','right','justify']).optional(),spaceBefore:z.number().finite().min(0).max(1584).optional(),spaceAfter:z.number().finite().min(0).max(1584).optional(),leftIndent:z.number().finite().min(0).max(1584).optional(),rightIndent:z.number().finite().min(0).max(1584).optional(),firstLineIndent:z.number().finite().min(-1584).max(1584).optional(),bullet:pptBulletSchema.optional(),lineSpacing:z.object({unit:z.enum(['points','lines']),value:z.number().finite().positive()}).strict().superRefine((v,c)=>{if(v.value>(v.unit==='lines'?10:1584))c.addIssue({code:'custom',message:'Line spacing is at most10 lines or1584 points.'});}).optional()}).strict().refine(v=>Object.keys(v).length>0,'Supply a paragraph property.');
export const pptFormatSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,font:pptFontSchema.optional(),paragraph:pptParagraphSchema.optional()}).strict().superRefine((v,c)=>{
  if(!v.font&&!v.paragraph)c.addIssue({code:'custom',message:'Supply font and/or paragraph properties.'});
  if(v.selection.kind!=='powerpoint'||v.selection.shapeIds.length!==1||(v.selection.textLength!==undefined&&v.selection.textLength<1))c.addIssue({code:'custom',message:'Select one text shape or a nonempty text range in it.'});
  if((v.font?.name!==undefined||v.font?.color!==undefined||v.paragraph)&&(v.selection.kind!=='powerpoint'||!v.selection.replacementRevision))c.addIssue({code:'custom',message:'Font family/color or paragraph layout requires a verified rich text capture; obtain a new explicit reference.'});
  if((v.paragraph?.bullet||v.paragraph?.leftIndent!==undefined||v.paragraph?.rightIndent!==undefined||v.paragraph?.firstLineIndent!==undefined)&&(v.selection.kind!=='powerpoint'||v.selection.paragraphProfileVersion!==1))c.addIssue({code:'custom',message:'Lists/indents need an explicit versioned paragraph capture; old references cannot silently widen their snapshot scope.'});
});
