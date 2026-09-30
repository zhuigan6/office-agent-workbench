import {AppError} from './index.ts';
export function approvalChoice(confirmation:any,allow:boolean){
  const choices=allow?['proceed_once','allow_once','allow','approved','accept']:['cancel','reject_once','reject','deny','decline'];
  const option=(confirmation.options || []).find((o:any)=>choices.includes(o.value));
  if(!option)throw new AppError('APPROVAL_OPTION_UNSUPPORTED','This agent did not provide a recognized one-time decision. No permanent permission was granted.');
  return option.value as string;
}
export function normalizedApproval(c:any,native:boolean,messages:any[]=[]){
  let canAllow=false,canDeny=false;
  try{approvalChoice(c,true);canAllow=true;}catch{}
  try{approvalChoice(c,false);canDeny=true;}catch{}
  // Native ACP/session adapters route by call_id; msg_id is ignored by them.
  let messageId=native?(c.id || c.call_id):c.msg_id;
  if(!native&&!messageId&&typeof c.call_id==='string'){
    // Core0.2.2 journals aionrs tool messages under a prefixed public call ID.
    // Use the actual journal msg_id, never synthesize one or pick the last tool.
    const candidates=messages.filter(m=>m?.type==='tool_call'&&typeof m.msg_id==='string'&&
      (m.content?.call_id===c.call_id||m.content?.call_id==='aionrs-'+c.call_id));
    const ids=new Set(candidates.map(m=>m.msg_id));
    if(ids.size===1)messageId=[...ids][0];
  }
  return {...c,...(messageId?{msg_id:messageId}:{}),canAllow,canDeny};
}
