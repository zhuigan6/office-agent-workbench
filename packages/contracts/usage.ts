export function reportedUsage(value:any){
  const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
  const meta=value?._meta || {};
  return {available:Boolean(value&&typeof value==='object'&&('used' in value||'cost' in value||'_meta' in value)),
    contextUsed:number(value?.used),contextSize:number(value?.size),
    inputTokens:number(meta.input_tokens),outputTokens:number(meta.output_tokens),
    cachedReadTokens:number(meta.cached_read_tokens),cachedWriteTokens:number(meta.cached_write_tokens),
    amount:number(value?.cost?.amount),currency:typeof value?.cost?.currency==='string'&&/^[A-Z]{3}$/.test(value.cost.currency)?value.cost.currency:null,
    source:'agent-reported',billingVerified:false};
}
