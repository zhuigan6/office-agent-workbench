import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

// Keep parser diagnostics out of the structured response and application logs.
console.log=()=>{};console.warn=()=>{};console.error=()=>{};
try {
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('input');}
  const {filename,start,end}=JSON.parse(input);
  const bytes=await fs.readFile(filename);if(bytes.length>32*1024*1024)throw Error('size');
  const require=createRequire(import.meta.url),base=path.dirname(require.resolve('pdfjs-dist/package.json'));
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),verbosity:0,isEvalSupported:false,useWasm:false,useSystemFonts:false,
    disableFontFace:true,cMapUrl:path.join(base,'cmaps').replaceAll('\\','/')+'/',cMapPacked:true,standardFontDataUrl:path.join(base,'standard_fonts').replaceAll('\\','/')+'/'});
  const doc=await task.promise;
  try {
    if(start>doc.numPages)throw Error('page');
    const pages=[];let remaining=24000,truncated=false;
    for(let number=start;number<=Math.min(end,doc.numPages);number++){
      const page=await doc.getPage(number),content=await page.getTextContent();
      let text='';for(const item of content.items)if('str' in item){const segment=item.str+(item.hasEOL?'\n':' ');text+=segment.slice(0,remaining-text.length);if(text.length>=remaining){truncated=true;break;}}
      remaining-=text.length;pages.push({page:number,text:text.trim()});page.cleanup();
      if(!remaining){truncated=true;break;}
    }
    process.stdout.write(JSON.stringify({kind:'pdf-text',totalPages:doc.numPages,pages,truncated,
      morePages:pages.at(-1).page<doc.numPages,note:'Text-layer extraction only. Reading order may differ from visual layout; empty text does not mean a blank page. Scans and diagrams require vision/OCR.'}));
  }finally{await task.destroy();}
}catch{process.exitCode=1;}
