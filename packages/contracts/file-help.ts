import {AppError} from './index.ts';
export const batchWireReference='Batch wire format: [{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Example"}}] or [{"command":"set","path":"/Sheet1/A1","props":{"value":"10"}}]. Put element properties inside props, never at the command top level. add uses parent; set uses path and no type. Element help parent labels identify object kinds, not literal paths. Resolve document paths from help.paths; new slides/sheets use parent "/". Examples illustrate syntax only, not requested content.';
export function selectedHelp(raw:string,fields?:unknown){
  if(fields===undefined)return {output:raw.slice(0,24000),truncated:raw.length>24000};
  if(!Array.isArray(fields)||!fields.length||fields.length>20||fields.some(f=>typeof f!=='string'||!/^[-\w.{}]{1,80}$/.test(f)))throw new AppError('HELP_FIELDS','Select 1 to 20 property names from an element schema.');
  let schema:any;try{schema=JSON.parse(raw);}catch{throw new AppError('HELP_FIELDS','This help page is plain text; specify a format and element first.');}
  if(!schema.properties||typeof schema.properties!=='object')throw new AppError('HELP_FIELDS','Selected help needs an element property schema.');
  const entries:[string,unknown][]=[],missing:string[]=[];
  for(const field of fields){if(Object.hasOwn(schema.properties,field))entries.push([field,schema.properties[field]]);else missing.push(field);}
  const properties=Object.fromEntries(entries);
  return {output:{format:schema.format,element:schema.element,parent:schema.parent,paths:schema.paths,operations:schema.operations,properties,missing},truncated:false};
}
