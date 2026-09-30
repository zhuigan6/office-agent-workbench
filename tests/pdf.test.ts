import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pdfRange,readPdf} from '../packages/document-workspace/pdf.ts';

function fixture(){
  const stream='BT /F1 18 Tf 30 90 Td (PDF_MARKER_7391) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets:number[]=[];
  for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  return Buffer.from(pdf+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
test('PDF pages are bounded and reject ambiguous or injected options',()=>{
  assert.deepEqual(pdfRange(undefined),{start:1,end:3});
  assert.deepEqual(pdfRange(['--start','8']),{start:8,end:10});
  for(const args of [['--start','0'],['--start','1','--end','6'],['--start','2','--end','1'],['--start','1','--start','2'],['--url','https://example.org'],['--start']])assert.throws(()=>pdfRange(args));
});
test('bundled isolated PDF reader extracts text and rejects corrupt/out-of-range input',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-pdf-'));
  try{
    const file=path.join(dir,'fixture.pdf');await fs.writeFile(file,fixture());
    const result=await readPdf(file);
    assert.equal(result.totalPages,1);assert.equal(result.pages[0].text,'PDF_MARKER_7391');assert.equal(result.morePages,false);
    assert.match(result.note,/Scans/);
    await assert.rejects(readPdf(file,['--start','2']),{code:'PDF_READ_FAILED'});
    await fs.writeFile(file,'%PDF-invalid');await assert.rejects(readPdf(file),{code:'PDF_READ_FAILED'});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
