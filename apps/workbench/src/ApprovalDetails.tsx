import React from 'react';
export function ApprovalDetails({confirmation}:{confirmation:any}){
  const details=confirmation.permissionDetails;
  if(!details)return null;
  if(details.state==='conflict')return <p role="alert" className="error">同一审批标识的参数发生变化，不能批准。请停止并核对这次调用。</p>;
  if(details.state!=='observed')return <p className="muted">上游尚未返回这条审批的准确参数，不能根据工具名称推断修改内容。请核对对话中的工具调用；不要把历史调用当作本次参数。</p>;
  return <details className="approval-details"><summary>查看本次调用的准确参数</summary><pre>{JSON.stringify(details.input,null,2)}</pre>{details.redacted&&<small>凭据类字段已隐藏；这只是审批显示，不会修改实际工具参数。</small>}</details>;
}
