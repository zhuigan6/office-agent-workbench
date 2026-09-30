import https from 'node:https';
import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {wordParagraphSchema} from '../../packages/contracts/word-format.ts';
import {liveRequestShape} from '../../packages/contracts/live-tools.ts';

const url=process.env.WORKBENCH_URL!;
const token=process.env.WORKBENCH_TOOL_TOKEN!;
const ca=new X509Certificate(fs.readFileSync(process.env.WORKBENCH_CA!)).toString();
if(!url||!token)throw new Error('Missing Workbench scoped connection.');
function invoke(route:string,body:unknown):Promise<any>{
  return new Promise((resolve,reject)=>{
    const req=https.request(new URL(route,url),{method:'POST',ca,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}},res=>{
      res.setEncoding('utf8');let raw='';res.on('data',d=>{raw+=d;if(raw.length>2_000_000)req.destroy(new Error('Response limit exceeded'));});
      res.on('end',()=>{try{const result=JSON.parse(raw);if(res.statusCode!>=400)reject(new Error(`${result.code}: ${result.message}`));else resolve(result);}catch(e){reject(e);}});
    });req.on('error',reject);req.setTimeout(90000,()=>req.destroy(new Error('Workbench request timed out')));req.end(JSON.stringify(body));
  });
}
const result=async(route:string,args:unknown)=>{
  try{return {content:[{type:'text' as const,text:JSON.stringify(await invoke(route,args))}]};}
  catch(error){return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:String(error)}]};}
};
const server=new McpServer({name:'office-workbench',version:'0.1.0-alpha.2'});
let scope:{kind:string;capabilities:string[]};
try{scope=await invoke('/tools/capabilities',{}) as typeof scope;}
catch(error){
  // Rolling upgrades can briefly use the previous host. Authorization still
  // lives in that host; this fallback does not widen any document grant.
  if(!(error instanceof Error)||!error.message.startsWith('FORBIDDEN:'))throw error;
  scope={kind:'legacy',capabilities:['write','writeText']};
}
const legacy=process.env.WORKBENCH_TOOL_SURFACE==='legacy';
if(!legacy&&['word','excel','powerpoint'].includes(scope.kind))server.registerTool('office_live',{
  title:'Current Office document',description:'Read, locate and edit the currently bound live document. Start with action help; request help for one operation to get parameters/examples, then execute it with params. Use the frozen selectionId attached to the user message, never retarget it. Edits appear in Office; guarded recovery is recorded. Conflict/unknown means stop and inspect. No arbitrary COM, shell or implicit permission. File-copy work uses office_file instead.',
  inputSchema:liveRequestShape,
},args=>result('/tools/live',args));
if(legacy&&['word','excel','powerpoint'].includes(scope.kind))server.registerTool('office_target',{
  title:'Locate a fixed target without changing selection',description:'Resolve an explicit position in the bound document into an immutable selectionId for selected-edit tools. Excel: sheet/range. Word: exact text; multiple or overlapping matches return candidates, do not pick arbitrarily (match is 1-based and needs explicit user intent). PPT: slideId OR 1-based slideIndex and shapeId, optional paired textStart/textLength. Multiple windows require windowId. No activation or document edits. A selected-message lock refuses retargeting.',
  inputSchema:{kind:z.enum(['word','excel','powerpoint']),windowId:z.string().optional(),sheet:z.string().optional(),range:z.string().optional(),text:z.string().optional(),match:z.number().int().optional(),slideId:z.string().optional(),slideIndex:z.number().int().optional(),shapeId:z.string().optional(),textStart:z.number().int().optional(),textLength:z.number().int().optional()},
},args=>result('/tools/target',args));
if(legacy&&(scope.kind==='excel'||scope.kind==='legacy')){
if(scope.kind==='excel'&&scope.capabilities.includes('write'))server.registerTool('office_write_selection',{
  title:'Edit frozen Excel selection',description:'Use the selectionId explicitly attached to the user message. Target and original version come from that captured reference; changing the current Office selection cannot retarget this edit. Supply a unique operationId and exact-size matrices. Conflict/expired means stop and ask for a new capture, never fall back to another write tool.',
  inputSchema:{selectionId:z.string().max(100),operationId:z.string(),values:z.array(z.array(z.union([z.string(),z.number(),z.boolean(),z.null()]))).optional(),formulas:z.array(z.array(z.union([z.string(),z.number(),z.boolean(),z.null()]))).optional(),numberFormat:z.array(z.array(z.string())).optional()},
},args=>result('/tools/write-selection',args));
server.registerTool('office_read_range',{
  title:'Read bound Excel cells',description:'Read up to 1000 cells from the workbook bound to this conversation. Returns values, formulas, number formats and a revision. Read before editing; use a bounded address, e.g. A1:D12. No filesystem access.',
  inputSchema:{sheet:z.string(),range:z.string()},
},args=>result('/tools/read',args));
if(scope.capabilities.includes('write'))
server.registerTool('office_write_range',{
  title:'Edit bound Excel cells',description:'Batch edit the bound workbook. Supply the revision returned by office_read_range and a unique operationId. Matrix size must match the range. Use formulas (with =) explicitly; values are literal. A conflict means reread, then decide a NEW operation. Unknown means inspect before doing anything again.',
  inputSchema:{sheet:z.string(),range:z.string(),operationId:z.string(),expectedRevision:z.string(),
    values:z.array(z.array(z.union([z.string(),z.number(),z.boolean(),z.null()]))).optional(),
    formulas:z.array(z.array(z.union([z.string(),z.number(),z.boolean(),z.null()]))).optional(),
    numberFormat:z.array(z.array(z.string())).optional()},
},args=>result('/tools/write',args));
}
server.registerTool('office_file',{
  title:'Office files and PDF text',
  description:'OfficeCLI file workspace. create and batch REQUIRE a stable operationId (for example task-word-v1). create can include commands to generate and populate the file in ONE call. help with format and optional element args discovers original syntax. Inspect bounded paths and batch related edits; mutations produce NEW copies, never edit the live Office window. Reuse operationId only for identical retries. Returned file IDs are downloadable. Assets use asset:<uploaded-file-id>. No shell, installation or arbitrary disk paths.',
  inputSchema:{action:z.enum(['list','help','inspect','create','batch','merge','import']),fileId:z.string().optional(),format:z.enum(['docx','xlsx','pptx']).optional(),command:z.enum(['view','get','query','validate','raw','dump']).optional(),args:z.array(z.string()).optional(),fields:z.array(z.string()).max(20).optional().describe('For help only: return selected original property definitions, e.g. fields=["data","rows","cols"], instead of the entire element schema.'),data:z.record(z.union([z.string(),z.number(),z.boolean(),z.null()])).optional().describe('merge only: replace {{key}} in an uploaded template with scalar JSON fields; creates a new copy, requires operationId.'),
    dataFileId:z.string().optional().describe('import only: uploaded CSV/TSV attached to this task; fileId is the xlsx target.'),sheet:z.string().optional().describe('import target, e.g. /Sheet1'),startCell:z.string().optional(),header:z.boolean().optional(),delimiter:z.enum([',',';','|','\t']).optional(),decimal:z.enum(['.',',']).optional(),
    commands:z.array(z.record(z.unknown())).optional().describe('Original structured OfficeCLI batch commands; combine with create to populate a new file without extra round trips.'),operationId:z.string().optional().describe('Required for create/batch/merge/import. Stable unique ID, 1-100 letters/digits/underscores/hyphens. Reuse only for identical retries.')},
},args=>result('/tools/file',args));
if(legacy&&(scope.kind==='word'||scope.kind==='powerpoint'||scope.kind==='legacy')){
if(scope.kind==='powerpoint')server.registerTool('office_inspect_slide',{
  title:'Read slide object locations',description:'Read bounded shape IDs, names, types, text previews and geometry from the bound presentation. Obtain slideId from office_read_text. Includes non-text shapes. Does not activate or modify the slide.',
  inputSchema:{slideId:z.string(),start:z.number().int().min(0).optional(),count:z.number().int().min(1).max(50).optional()},
},args=>result('/tools/shapes',args));
if(scope.kind==='powerpoint'&&scope.capabilities.includes('writeText'))server.registerTool('office_layout_selection',{
  title:'Move or size a fixed PowerPoint shape',description:'Change left/top/width/height/rotation (points/degrees) for a single shape from a frozen selectionId with layoutRevision. Existing aspect-ratio lock is honored, not disabled. Group layout is currently refused. Returns verified geometry and records guarded restoration. Stale/unknown outcomes require inspection, never a blind retry.',
  inputSchema:{selectionId:z.string().max(100),operationId:z.string(),geometry:z.object({left:z.number().optional(),top:z.number().optional(),width:z.number().optional(),height:z.number().optional(),rotation:z.number().optional()}).strict()},
},args=>result('/tools/layout-selection',args));
if(scope.kind==='word'&&scope.capabilities.includes('writeText'))server.registerTool('office_replace_selection',{
  title:'Replace frozen Word selection',description:'Replace text in the referenced frozen Word body selection (up to 2000 characters, one paragraph). Unchanged text keeps formatting; changed text inherits local font. No paragraph controls, tables, fields, embedded objects, tracked or protected content. Keeps a full-paragraph snapshot for guarded restoration; later paragraph edits block restore. Conflict/unknown means stop, never retry blindly or substitute another tool.',
  inputSchema:{selectionId:z.string().max(100),operationId:z.string(),text:z.string().max(2000)},
},args=>result('/tools/replace-selection',args));
if((scope.kind==='word'||scope.kind==='powerpoint')&&scope.capabilities.includes('writeText'))server.registerTool('office_format_selection',{
  title:'Format frozen Office text selection',description:'Apply bold, italic or font size without replacing text. Word also supports paragraph alignment, spacing/indent in points and keep flags, only for 1 to 20 complete main-body paragraphs (final paragraph mark optional); partial paragraphs are refused, never expanded. Font and paragraph properties may be combined. Up to 2000 characters; snapshots restore mixed formats under revision guards. PowerPoint is font-only, size at most 400pt. Protected/tracked/field/content-control content is refused. Conflict or unknown means stop, never blind retry or fallback.',
  inputSchema:{selectionId:z.string().max(100),operationId:z.string(),font:z.object({bold:z.boolean().optional(),italic:z.boolean().optional(),size:z.number().min(1).max(1638).multipleOf(0.5).optional()}).strict().optional(),...(scope.kind==='word'?{paragraph:wordParagraphSchema.optional()}:{})},
},args=>result('/tools/format-selection',args));
server.registerTool('office_read_text',{
  title:'Read live Word or PowerPoint text',description:'Read bounded Word paragraphs or PowerPoint slide/shape text. Returns stable targets and revisions. In PowerPoint first list slides, then pass a slideId. No filesystem edits.',
  inputSchema:{start:z.number().int().min(0).optional(),count:z.number().int().min(1).max(50).optional(),slideId:z.string().optional(),shapeId:z.string().optional()},
},args=>result('/tools/read-text',args));
if(scope.capabilities.includes('writeText'))
server.registerTool('office_write_text',{
  title:'Replace one live text target',description:'Replace a plain Word paragraph or a PowerPoint text shape using a target and expectedRevision from office_read_text. Preserves other targets. Rich Word paragraphs may be rejected. A conflict requires rereading; unknown requires inspection, never blind retry.',
  inputSchema:{target:z.union([z.object({kind:z.literal('word'),paragraphId:z.string()}),z.object({kind:z.literal('powerpoint'),slideId:z.string(),shapeId:z.string()})]),expectedRevision:z.string(),operationId:z.string(),text:z.string().max(32767)},
},args=>result('/tools/write-text',args));
}
await server.connect(new StdioServerTransport());
