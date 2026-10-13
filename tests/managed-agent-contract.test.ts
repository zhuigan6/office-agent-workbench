import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../packages/aioncore-adapter/catalog.ts';
import type {AionCore} from '../packages/aioncore-adapter/index.ts';
import {managedDocumentInstructions,nativeDocumentInstructions,documentInstructions} from '../packages/native-sessions/document-context.ts';
test('managed and shared native tasks use the same live/file/wait/selection contract with exact server names',()=>{
  assert.equal(nativeDocumentInstructions,documentInstructions('workbench-native-docs'));assert.ok(managedDocumentInstructions.includes('configured office-workbench MCP server'));
  for(const instruction of [managedDocumentInstructions,nativeDocumentInstructions]){assert.ok(instruction.includes('office_live'));assert.ok(instruction.includes('office_file'));assert.ok(instruction.includes('SAME call'));assert.ok(instruction.includes('frozen selectionId'));}
  assert.doesNotMatch(managedDocumentInstructions,/office_read_range|office_write_range|office_read_text|office_write_text/);assert.ok(managedDocumentInstructions.includes('stable operationId'));
});
test('catalog reports installation evidence, not authenticated runtime acceptance',async()=>{
  const core={request:async(_method:string,route:string)=>route==='/api/providers'?[]:[{id:'claude',name:'Claude',agent_type:'acp',enabled:true,installed:true,status:'online',private_secret:'must-not-export'},{id:'missing',agent_type:'acp',enabled:true,installed:false,status:'online'}]} as unknown as AionCore;
  const result=await catalog(core);assert.equal(result.agentDiscoveryFailed,false);assert.equal(result.agents[1].status,'detected');assert.equal(result.agents[2].status,'missing');assert.ok(!JSON.stringify(result).includes('private_secret'));
});
test('agent discovery failures are explicit and never interpreted as account removal',async()=>{
  for(const response of [{unrecognized:true},null]){const core={request:async(_method:string,route:string)=>route==='/api/providers'?[]:response} as unknown as AionCore;const result=await catalog(core);assert.equal(result.agentDiscoveryFailed,true);assert.equal(result.agents[0].id,'aionrs');}
});
