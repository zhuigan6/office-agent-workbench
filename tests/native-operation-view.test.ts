import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Store,digest} from '../packages/document-workspace/store.ts';
import {nativeOperationsForStore,nativeOperationSummary,nativeOperationPage,assertNativeOperationForStore,unresolvedNativeOperationsForStore} from '../packages/native-sessions/operations.ts';
import {NativeLayoutSummary,NativeOperationDetails} from '../apps/workbench/src/NativeOperationView.tsx';
const link='00000000-0000-0000-0000-000000000001',prefix=link.slice(0,32)+'_';
test('scoped operation/recovery lookup remains complete beyond the global500-row history window',()=>{
  const store=new Store(':memory:');try{
    const id=prefix+'old';store.begin(id,'doc','ppt.layout',{});store.updateOperation(id,'unknown',{privateMarker:'local-only'});
    const applied=prefix+'applied';store.begin(applied,'doc','ppt.layout',{});store.updateOperation(applied,'applied',{verified:true,before:{privateMarker:'full-snapshot'}});
    const recovery='restore_'+digest(applied).slice(0,48);store.begin(recovery,'doc','ppt.layout',{});store.updateOperation(recovery,'unknown',{privateMarker:'full-undo'});
    for(let i=0;i<510;i++){store.begin('unrelated_'+i,'other','word.format',{});store.updateOperation('unrelated_'+i,'applied',{});}
    assert.equal(store.operations().some(op=>op.id===id),false);
    assert.deepEqual(new Set(unresolvedNativeOperationsForStore(store,link,'doc')),new Set([id,recovery]));
    const scoped=nativeOperationsForStore(store,link,'doc');assert.equal(scoped.length,2);assert.equal(scoped.find(op=>op.id===applied)?.recovery?.status,'unknown');assert.equal(assertNativeOperationForStore(store,link,'doc',id).id,id);
    assert.throws(()=>assertNativeOperationForStore(store,link,'other',id),{code:'NATIVE_OPERATION_SCOPE'});assert.throws(()=>assertNativeOperationForStore(store,'10000000-0000-0000-0000-000000000001','doc',id),{code:'NATIVE_OPERATION_SCOPE'});
    assert.ok(!JSON.stringify(scoped.map(nativeOperationSummary)).includes('privateMarker'));assert.ok(JSON.stringify(assertNativeOperationForStore(store,link,'doc',id)).includes('local-only'));
  }finally{store.close();}
});
test('operation cursor pages are stable while new writes arrive and never cross scope',()=>{
  const store=new Store(':memory:');try{
    for(let i=0;i<45;i++){store.begin(prefix+i,'doc','word.format',{});store.updateOperation(prefix+i,'applied',{verified:true,before:{text:'private-source'}});}
    let records=nativeOperationsForStore(store,link,'doc');const first=nativeOperationPage(records);assert.equal(first.items.length,20);assert.equal(first.hasMore,true);
    const second=nativeOperationPage(records,first.nextCursor!);assert.equal(second.items.length,20);assert.equal(new Set([...first.items,...second.items].map(op=>op.id)).size,40);
    store.begin(prefix+'new','doc','word.format',{});store.updateOperation(prefix+'new','applied',{verified:true,before:{text:'private-source'}});records=nativeOperationsForStore(store,link,'doc');assert.deepEqual(nativeOperationPage(records,first.nextCursor!).items.map(op=>op.id),second.items.map(op=>op.id));
    assert.equal(nativeOperationPage(records,second.nextCursor!).items.length,5);assert.equal(nativeOperationPage(records,second.nextCursor!).hasMore,false);
    assert.throws(()=>nativeOperationPage(records,'foreign'),{code:'NATIVE_OPERATION_SCOPE'});assert.ok(!JSON.stringify(first).includes('private-source'));assert.ok(first.items.every(op=>op.view.canRestore));
  }finally{store.close();}
});
test('layout view distinguishes historical verified results from partial failure, not requested guesses',()=>{
  const html=renderToStaticMarkup(createElement(NativeLayoutSummary,{kind:'ppt.layout.batch',recovered:true,receipt:{steps:[{operationId:'a',shapeId:'2',status:'applied',verified:true,geometry:{left:80,top:300,width:260,height:29.0812},appearance:{fill:{mode:'solid',color:'#F2DEB5',transparency:0.1},outline:{mode:'none'}}},{operationId:'b',shapeId:'3',status:'failed',verified:false}]}}));
  for(const text of ['已恢复','本次修改时','对象 2','已验证修改','29.08','#F2DEB5','透明度','10%','对象 3','未完成','未取得写入后的实际位置'])assert.ok(html.includes(text),text);
  let calls=0;const details=renderToStaticMarkup(createElement(NativeOperationDetails,{api:async()=>{calls++;return {};},linkId:link,operationId:prefix+'a',version:'1'}));assert.equal(calls,0);assert.ok(!details.includes('<pre>'));
});
test('layout view exposes fit/readability and canvas warnings without calling them completed design',()=>{
  const html=renderToStaticMarkup(createElement(NativeLayoutSummary,{kind:'ppt.layout.batch',recovered:false,receipt:{steps:[{operationId:'fit',shapeId:'2',status:'applied',verified:true,textFrame:{AutoSize:2},minimumFontSize:7,layoutCheck:{mayOverflow:true},slideCheck:{mayClip:true}}]}}));
  for(const text of ['缩小文字以适应','实际最小字号','检查可读性','可能溢出','越过幻灯片画布'])assert.ok(html.includes(text),text);
});
