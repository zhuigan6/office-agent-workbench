const narrowing='Use the original OfficeCLI help for this command to request a smaller path/range, depth, page or supported result limit. This response is partial, not a complete document inspection.';
export function boundedInspection(output:unknown,limit=24000){
  if(!Number.isInteger(limit)||limit<1000)throw new RangeError('Inspection budget must be at least 1000 characters.');
  const encoded=JSON.stringify(output);
  if(encoded.length<=limit)return {output,truncated:false};
  if(typeof output==='string'){
    let lo=0,hi=Math.min(output.length,limit-2);
    while(lo<hi){const middle=Math.ceil((lo+hi)/2);if(JSON.stringify(output.slice(0,middle)).length<=limit)lo=middle;else hi=middle-1;}
    if(lo&&/[\uD800-\uDBFF]/.test(output[lo-1]))lo--;
    return {output:output.slice(0,lo),truncated:true,narrowing};
  }
  const source=output as any,rows=source?.data?.results;
  if(Array.isArray(rows)){
    const selected:unknown[]=[],preview={...source,data:{...source.data,results:selected},partial:true,returnedResultCount:0,omittedResultCount:rows.length};
    if(JSON.stringify(preview).length<=limit){
      for(const row of rows){
        selected.push(row);preview.returnedResultCount=selected.length;preview.omittedResultCount=rows.length-selected.length;
        if(JSON.stringify(preview).length>limit){selected.pop();preview.returnedResultCount=selected.length;preview.omittedResultCount=rows.length-selected.length;break;}
      }
      return {output:preview,truncated:true,narrowing};
    }
  }
  return {output:{partial:true,kind:'oversized-structured-result',originalCharacters:encoded.length,rootKeys:source&&typeof source==='object'?Object.keys(source).slice(0,10).map(key=>key.slice(0,40)):[]},truncated:true,narrowing};
}
