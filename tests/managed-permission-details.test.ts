import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {ManagedPermissionDetails} from '../packages/aioncore-adapter/permission-details.ts';
import {ApprovalDetails} from '../apps/workbench/src/ApprovalDetails.tsx';
const event=(input:any={action:'help'})=>({name:'message.stream',data:{conversation_id:'c',turn_id:'t',type:'acp_permission',data:{tool_call:{tool_call_id:'permission-id',title:'mcp__office-workbench__office_file',raw_input:input}}}});
const confirmation={id:'permission-id',call_id:'permission-id',title:'mcp__office-workbench__office_file',canAllow:true};
test('exact upstream permission identity enriches metadata; tool name or neighboring history never substitutes',()=>{
  const cache=new ManagedPermissionDetails();assert.equal(cache.capture(event()),true);
  assert.deepEqual(cache.enrich(confirmation,'c','t').permissionDetails,{state:'observed',turnId:'t',input:{action:'help'},redacted:false});
  for(const [candidate,conversation,turn] of [[confirmation,'foreign','t'],[confirmation,'c','other'],[{...confirmation,call_id:'other'},'c','t'],[{...confirmation,title:'Bash'},'c','t'],[confirmation,'c',null]] as const)assert.equal(cache.enrich(candidate,conversation,turn).permissionDetails.state,'unavailable');
  assert.equal(cache.capture({...event(),data:{...event().data,type:'tool_call'}}),false);
});
test('permission parameters are detached/redacted for presentation, never modified for execution',()=>{
  const cache=new ManagedPermissionDetails(),input={action:'help',nested:{api_key:'sensitive',ANTHROPIC_API_KEY:'also-private',path:'local.docx'},array:[{password:'private'}]};cache.capture(event(input));
  const result=cache.enrich(confirmation,'c','t');assert.equal(result.permissionDetails.redacted,true);assert.deepEqual(result.permissionDetails.input,{action:'help',nested:{api_key:'[REDACTED]',ANTHROPIC_API_KEY:'[REDACTED]',path:'local.docx'},array:[{password:'[REDACTED]'}]});
  result.permissionDetails.input.nested.path='changed';assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.input.nested.path,'local.docx');assert.equal(input.nested.api_key,'sensitive');
});
test('changed repeated input is fenced; equivalent key ordering is accepted and exact completed turn clears details',()=>{
  let now=0;const cache=new ManagedPermissionDetails(()=>now);cache.capture(event({a:1,b:2}));assert.equal(cache.capture(event({b:2,a:1})),true);
  assert.equal(cache.capture(event({a:2,b:2})),false);assert.equal(cache.enrich(confirmation,'c','t').canAllow,false);assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'conflict');
  now=12*3600000+1;assert.equal(cache.enrich({...confirmation,title:'Changed tool'},'c','other').canAllow,false,'Expiry/title changes must not lift an observed ID conflict');
  cache.complete('c','other');assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'conflict');cache.capture({name:'turn.completed',data:{conversation_id:'c',turn_id:'t'}});assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'unavailable');
});
test('oversized, malformed, stale and evicted details do not attach to another approval',()=>{
  let now=0;const cache=new ManagedPermissionDetails(()=>now);assert.equal(cache.capture(event({value:'x'.repeat(262145)})),false);
  const missing=event();delete (missing.data.data.tool_call as any).raw_input;assert.equal(cache.capture(missing),false);
  const cyclic:any={};cyclic.self=cyclic;assert.equal(cache.capture(event(cyclic)),false);
  const invalid=event();invalid.data.turn_id='';assert.equal(cache.capture(invalid),false);cache.clear();
  cache.capture(event());now=12*3600000+1;assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'unavailable');
  for(let index=0;index<257;index++){const item=event();item.data.data.tool_call.tool_call_id='p'+index;cache.capture(item);}assert.equal(cache.enrich({...confirmation,call_id:'p0'},'c','t').permissionDetails.state,'unavailable');assert.equal(cache.enrich({...confirmation,call_id:'p256'},'c','t').permissionDetails.state,'observed');
});
test('approval view escapes tool-supplied HTML and distinguishes missing/conflicting parameters',()=>{
  const observed=renderToStaticMarkup(createElement(ApprovalDetails,{confirmation:{permissionDetails:{state:'observed',input:{text:'<script>alert(1)</script>'},redacted:true}}}));assert.ok(observed.includes('&lt;script&gt;'));assert.ok(!observed.includes('<script>'));assert.ok(observed.includes('准确参数'));
  assert.ok(renderToStaticMarkup(createElement(ApprovalDetails,{confirmation:{permissionDetails:{state:'unavailable'}}})).includes('不能根据工具名称推断'));
  assert.ok(renderToStaticMarkup(createElement(ApprovalDetails,{confirmation:{permissionDetails:{state:'conflict'}}})).includes('不能批准'));
});
test('event disconnect invalidates parameter freshness without lifting conflicts or forgetting ID hashes',()=>{
  const cache=new ManagedPermissionDetails();cache.capture(event());
  cache.capture({name:'core.events.disconnected'});
  assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'unavailable');
  cache.capture({name:'core.events.connected'});
  assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'unavailable','Connection alone cannot revalidate old parameters');
  cache.capture(event());assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'observed');
  cache.capture({name:'core.events.disconnected'});cache.capture(event({action:'create'}));
  assert.equal(cache.enrich(confirmation,'c','t').permissionDetails.state,'conflict');
  cache.capture({name:'core.events.disconnected'});cache.capture(event());
  assert.equal(cache.enrich(confirmation,'c','t').canAllow,false);
});
