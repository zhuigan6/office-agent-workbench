import test from 'node:test';
import assert from 'node:assert/strict';
import {assertLiteralCsv} from '../packages/document-workspace/csv-safety.ts';
test('literal import blocks formulas including quoted/whitespace/BOM variants, without rejecting negative numbers',()=>{
  for(const text of ['a,b\nx,=1+1','a,b\nx," =1+1"','\uFEFFa,b\nx,=HYPERLINK("url")','a,b\nx,"\n=1+1"'])assert.throws(()=>assertLiteralCsv(Buffer.from(text),','),{code:'CSV_LITERAL_REQUIRED'});
  assert.throws(()=>assertLiteralCsv(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('a\tb\nx\t=1+1','utf16le')]),'\t'));
  assert.doesNotThrow(()=>assertLiteralCsv(Buffer.from('a;b\n"North;West";-1.234,5'),';'));
  assert.doesNotThrow(()=>assertLiteralCsv(Buffer.from('a,b\n"quote ""hello""",-120'),','));
});
test('ambiguous encodings and malformed or oversized CSV fields fail before engine execution',()=>{
  for(const bytes of [Buffer.from([0xff,0xfe,0,0]),Buffer.from([0xff,0xff]),Buffer.from('a\0,b'),Buffer.from('"unclosed'),Buffer.from('"closed"garbage,b'),Buffer.from('x'.repeat(32768))])assert.throws(()=>assertLiteralCsv(bytes,','));
});
