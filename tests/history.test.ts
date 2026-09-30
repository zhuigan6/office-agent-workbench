import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HistoryWindow} from '../apps/workbench/src/history.ts';

test('polling retains older pages, finished cursor and updates existing messages',()=>{
  const h=new HistoryWindow();h.select('a');
  h.apply(h.begin()!,{items:[{id:'b',text:'partial'}],oldest_cursor:'b',has_more_before:true});
  const older=h.begin(true)!;assert.equal(h.begin(true),undefined);
  h.apply(older,{items:[{id:'a'}],oldest_cursor:'a',has_more_before:false});
  h.apply(h.begin()!,{items:[{id:'b',text:'done'},{id:'c'}],oldest_cursor:'b',has_more_before:true});
  assert.deepEqual(h.items.map(m=>m.id),['a','b','c']);
  assert.equal(h.items[1].text,'done');assert.equal(h.cursor,'a');assert.equal(h.hasOlder,false);
});
test('old task results cannot contaminate revisited tasks; out-of-order polling is ignored',()=>{
  const h=new HistoryWindow();h.select('a');const stale=h.begin()!;
  h.select('b');h.select('a');assert.equal(h.apply(stale,{items:[{id:'wrong'}]}),false);
  const first=h.begin()!,second=h.begin()!;
  h.apply(second,{items:[{id:'new'}]});assert.equal(h.apply(first,{items:[{id:'old'}]}),false);
  assert.deepEqual(h.items.map(m=>m.id),['new']);
});
test('failed paging can retry and nonadvancing cursors cannot loop',()=>{
  const h=new HistoryWindow();h.select('a');
  h.apply(h.begin()!,{items:[{id:'b'}],oldest_cursor:'b',has_more_before:true});
  const failed=h.begin(true)!;h.fail(failed);const retry=h.begin(true)!;assert.ok(retry);
  h.apply(retry,{items:[{id:'b'}],oldest_cursor:'b',has_more_before:true});
  assert.equal(h.items.length,1);assert.equal(h.hasOlder,false);
});
