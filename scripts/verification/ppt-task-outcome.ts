import assert from 'node:assert/strict';
export function finalPptLayoutChildren(operations:any[],shapeIds:string[]){
  const final=new Map<string,any>();
  for(const op of [...operations].sort((a,b)=>a.createdAt-b.createdAt)){
    assert.equal(op.status,'applied','Uncertain or partial task results need inspection, not replay.');
    for(const child of op.result.children){
      assert.equal(child.status,'applied');assert.equal(child.result.verified,true);
      const id=child.result.after.state.shapeId;assert.ok(shapeIds.includes(id));final.set(id,child);
    }
  }
  assert.equal(final.size,shapeIds.length);return shapeIds.map(id=>final.get(id));
}
