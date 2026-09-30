export function messageText(message:any):string {
  const value=message?.content ?? message?.body ?? message?.data;
  if(typeof value==='string'){
    try {const parsed=JSON.parse(value);return typeof parsed==='object'&&parsed!==null?messageText({content:parsed}):value;} catch {return value;}
  }
  if(Array.isArray(value))return value.map(v=>typeof v==='string'?v:messageText({content:v})).filter(Boolean).join('\n');
  if(value&&typeof value==='object'){
    for(const field of ['text','content','message'])if(typeof value[field]==='string'&&value[field])return value[field];
    if(value.code==='ACP_EMPTY_TURN')return '智能体已结束本轮，但没有返回文本。若本轮发送的是压缩等命令，这不代表该操作已验证成功。';
    return JSON.stringify(value);
  }
  return '';
}
