import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {X509Certificate,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {WorkbenchClient,httpsTransport} from '../packages/client/index.ts';
import {loadConfig,local} from '../apps/local-host/config.ts';

const id=process.argv[2];if(!id||!/^[\w-]+$/.test(id))throw Error('Provide an existing dedicated test conversation ID.');
const cfg=loadConfig(),ca=new X509Certificate(await fs.readFile(path.join(local,'server.cer'))).toString();
const http=new WorkbenchClient({port:cfg.port,token:cfg.uiToken,ca});
const conversations=await http.conversations() as any[],conversation=conversations.find(row=>row.id===id);
if(!conversation||conversation.turn||conversation.documentId)throw Error('Use an idle dedicated file-task conversation, not a live document task.');
const grant=(await http.access(id) as any).mcpServers['office-workbench'];
const client=new Client({name:'workbench-template-acceptance',version:'1'}),transport=new StdioClientTransport({...grant,stderr:'pipe'});
const output=path.join(local,'verification','mcp-template-'+Date.now());await fs.mkdir(output,{recursive:true});
async function call(args:any){const result=await client.callTool({name:'office_file',arguments:args});assert.notEqual(result.isError,true,'Scoped tool returned an error');const content=result.content as any[];return JSON.parse(content.find(item=>item.type==='text').text);}
try{
  await client.connect(transport);const tools=await client.listTools();
  const fileTool=tools.tools.find(tool=>tool.name==='office_file');assert.ok(fileTool);assert.ok((fileTool.inputSchema.properties?.action as any).enum.includes('merge'));
  const original=await call({action:'create',format:'docx',operationId:randomUUID(),commands:[{command:'add',parent:'/body',type:'paragraph',props:{text:'MCP {{name}}'}}]});
  const request={action:'merge',fileId:original.file.id,data:{name:'VERIFIED'},operationId:randomUUID()};
  const merged=await call(request);assert.equal(merged.file.sourceId,original.file.id);assert.equal(merged.validation.exitCode,0);
  assert.equal((await call(request)).file.id,merged.file.id);
  assert.match(JSON.stringify(await call({action:'inspect',fileId:merged.file.id,command:'view',args:['text']})),/MCP VERIFIED/);
  assert.match(JSON.stringify(await call({action:'inspect',fileId:original.file.id,command:'view',args:['text']})),/MCP \{\{name\}\}/);
  const unattached=await http.upload('unattached-scope-probe.txt',Buffer.from('synthetic scope probe')) as any;
  const denied=await client.callTool({name:'office_file',arguments:{action:'inspect',fileId:unattached.id}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied.content),/FILE_SCOPE/);
  const admin=await httpsTransport({url:new URL('/api/archives',http.origin),method:'GET',headers:{Authorization:`Bearer ${grant.env.WORKBENCH_TOOL_TOKEN}`},ca,timeoutMs:5000});assert.equal(admin.status,403);
  assert.ok((fileTool.inputSchema.properties?.action as any).enum.includes('import'));
  const book=await call({action:'create',format:'xlsx',operationId:randomUUID()});
  const csv=await http.upload('mcp-import.csv',Buffer.from('Region,Amount\nNorth,65'),id) as any;
  const imported=await call({action:'import',fileId:book.file.id,dataFileId:csv.id,sheet:'/Sheet1',header:true,operationId:randomUUID()});
  assert.equal(imported.validation.exitCode,0);assert.match(JSON.stringify(await call({action:'inspect',fileId:imported.file.id,command:'get',args:['/Sheet1/B2']})),/65/);
  const formula=await http.upload('mcp-formula-probe.csv',Buffer.from('Region,Amount\nNorth,=1+1'),id) as any;
  const refused=await client.callTool({name:'office_file',arguments:{action:'import',fileId:book.file.id,dataFileId:formula.id,sheet:'/Sheet1',operationId:randomUUID()}});assert.equal(refused.isError,true);assert.match(JSON.stringify(refused.content),/CSV_LITERAL_REQUIRED/);
  const report={passed:true,conversation:id,mergeDiscovered:true,createMergeReadback:true,originalPreserved:true,replayedSameFile:true,unattachedFileDenied:true,archivesDenied:true,csvImportReadback:true,csvFormulaRefused:true,file:merged.file.id,modelTurnIssued:false};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}));
}finally{await client.close();}
