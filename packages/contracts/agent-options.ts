import {AppError} from './index.ts';
export type AgentOption={id:string;name:string;category:string;currentValue:string|null;choices:{value:string;name:string}[]};
export function agentOptions(input:unknown):AgentOption[]{
  if(!Array.isArray(input))return [];
  return input.filter(o=>o&&o.type==='select'&&['model','thought_level'].includes(o.category)&&typeof o.id==='string'&&o.id.length<=200).map(o=>({
    id:o.id,name:typeof o.name==='string'?o.name:o.id,category:o.category,currentValue:typeof o.current_value==='string'?o.current_value:null,
    choices:(Array.isArray(o.options)?o.options:[]).flatMap((v:any)=>Array.isArray(v.options)?v.options:[v]).filter((v:any)=>v&&typeof v.value==='string'&&v.value.length<=200).slice(0,200).map((v:any)=>({value:v.value,name:typeof v.name==='string'?v.name:v.value}))
  })).filter(o=>o.choices.length);
}
export function validateAgentOption(options:unknown,id:unknown,value:unknown){
  if(typeof id!=='string'||typeof value!=='string')throw new AppError('INVALID_OPTION','Select an advertised model or thinking value.');
  const option=agentOptions(options).find(o=>o.id===id);
  if(!option||!option.choices.some(c=>c.value===value))throw new AppError('OPTION_NOT_ADVERTISED','This setting is unavailable or its choices changed. Refresh first.');
  return {optionId:id,value};
}
export function observedAgentOption(result:any,id:string,value:string){
  const options=agentOptions(result?.config_options);
  if(result?.confirmation!=='observed'||options.find(o=>o.id===id)?.currentValue!==value)throw new AppError('OPTION_UNCONFIRMED','Agent did not confirm the requested value. Refresh actual settings before retrying.',409);
  return options;
}
