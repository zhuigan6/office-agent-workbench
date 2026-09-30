import { randomUUID } from 'node:crypto';
import { AppError } from '../contracts/index.ts';
import type { AionCore } from './index.ts';

export async function catalog(core:AionCore,gatewayUrl?:string){
  const providers=await core.request('GET','/api/providers');
  const rows=Array.isArray(providers)?providers:providers.items || providers.providers || [];
  let agents:any[]=[];
  try{const response=await core.request('GET','/api/agents/management');agents=Array.isArray(response)?response:response.items || response.agents || [];}catch{}
  let gatewayModels:string[]=[];
  if(gatewayUrl)try{const response=await fetch(gatewayUrl+'/v1/models',{headers:{'x-api-key':'PROXY_MANAGED'},signal:AbortSignal.timeout(2000)});if(response.ok){const value=await response.json() as any;gatewayModels=(value.data || []).map((m:any)=>m.id).filter((id:any)=>typeof id==='string');}}catch{}
  return {
    agents:[{id:'aionrs',name:'AionCore',available:true,backend:'aionrs',type:'aionrs',status:'ready'},...agents.filter(a=>a.agent_type==='acp'&&a.enabled).map(a=>({id:a.id,name:a.name,backend:a.backend,type:'acp',available:a.installed===true||a.available===true,status:a.status || 'unchecked'}))],
    providers:rows.map((p:any)=>({id:p.id,name:p.name,platform:p.platform,models:p.id==='workbench-ccswitch'?[...new Set([...(p.models || []),...gatewayModels])]:p.models || [],source:p.id==='workbench-ccswitch'?'ccswitch':'direct-api'})),
  };
}
export async function addProvider(core:AionCore,input:any){
  if(!input||!['anthropic','openai'].includes(input.platform)||typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw new AppError('INVALID_PROVIDER','Supply a name and Anthropic or OpenAI API format.');
  let url:URL;try{url=new URL(input.baseUrl);}catch{throw new AppError('INVALID_URL','Provide an absolute HTTPS endpoint.');}
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new AppError('UNSAFE_ENDPOINT','Use HTTPS, or HTTP only for loopback. Do not put credentials in the URL.');
  if(typeof input.apiKey!=='string'||!input.apiKey||input.apiKey.length>4096)throw new AppError('INVALID_KEY','Provide an API key.');
  if(!Array.isArray(input.models)||!input.models.length||input.models.length>100||input.models.some((m:any)=>typeof m!=='string'||!m.trim()||m.length>200))throw new AppError('INVALID_MODELS','Provide 1 to 100 model identifiers.');
  const id=`workbench-${randomUUID()}`;
  await core.request('POST','/api/providers',{id,name:input.name.trim(),platform:input.platform,base_url:url.toString().replace(/\/$/,''),api_key:input.apiKey,models:input.models,enabled:true});
  return {id};
}
