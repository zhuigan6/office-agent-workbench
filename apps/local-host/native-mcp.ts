import https from 'node:https';
import fs from 'node:fs';
import {X509Certificate,randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {nativeConnectionFailure} from '../../packages/contracts/native-connection.ts';

const url=process.env.WORKBENCH_URL!,token=process.env.WORKBENCH_NATIVE_PROXY_TOKEN!;
const ca=new X509Certificate(fs.readFileSync(process.env.WORKBENCH_CA!)).toString();
async function invoke(route:string,body:unknown):Promise<any>{
  return new Promise((resolve,reject)=>{
    const req=https.request(new URL(route,url),{method:'POST',ca,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',chunk=>{raw+=chunk;if(raw.length>3*1024*1024)req.destroy(Object.assign(Error('Response limit'),{code:'NATIVE_DOCUMENT_RESPONSE_LIMIT'}));});
      res.on('error',error=>{clearTimeout(timer);reject(Error(nativeConnectionFailure(error)));});
      res.on('end',()=>{clearTimeout(timer);try{const value=JSON.parse(raw);if((res.statusCode??500)>=400)reject(Error(value.message||'Document request refused.'));else resolve(value);}catch{reject(Error('Document response unavailable.'));}});
    });
    const timer=setTimeout(()=>req.destroy(Object.assign(Error('Approval or execution timed out.'),{code:'NATIVE_DOCUMENT_TIMEOUT'})),120000);
    req.on('error',error=>{clearTimeout(timer);reject(Error(nativeConnectionFailure(error)));});req.end(JSON.stringify(body));
  });
}
const server=new Server({name:'workbench-native-docs',version:'0.1.0-alpha.2'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await invoke('/tools/native-catalog',{})}));
server.setRequestHandler(CallToolRequestSchema,async request=>{
  try{
    const result=await invoke('/tools/native-call',{callId:randomUUID(),tool:request.params.name,args:request.params.arguments??{}});
    return {isError:!result.success,content:result.contentItems.map((item:any)=>({type:'text',text:item.text}))};
  }catch(error){return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Document call failed.'}]};}
});
await server.connect(new StdioServerTransport());
