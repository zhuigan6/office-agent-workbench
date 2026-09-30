import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedHelp} from '../packages/contracts/file-help.ts';
test('selected help retains original upstream property rules without inventing unsupported fields',()=>{
  const schema={element:'table',format:'docx',properties:{data:{description:'original',add:true},rows:{type:'int'},unrelated:{description:'x'.repeat(10000)}}};
  const result=selectedHelp(JSON.stringify(schema),['data','missing']);
  assert.deepEqual((result.output as any).properties,{data:schema.properties.data});
  assert.deepEqual((result.output as any).missing,['missing']);assert.ok(JSON.stringify(result).length<500);
  assert.equal(selectedHelp('plain help').output,'plain help');assert.throws(()=>selectedHelp('plain help',['x']));
  assert.throws(()=>selectedHelp(JSON.stringify(schema),['__proto__/x']));
  const special=selectedHelp('{"properties":{"__proto__":{"type":"text"}}}',['__proto__']);
  assert.equal(Object.hasOwn((special.output as any).properties,'__proto__'),true);
  assert.equal(Object.getPrototypeOf((special.output as any).properties),Object.prototype);
});
