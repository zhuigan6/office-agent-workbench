import {AppError} from '../contracts/index.ts';

export function assertLiteralCsv(bytes:Buffer,delimiter:string){
  const fail=(message:string):never=>{throw new AppError('CSV_LITERAL_REQUIRED',message);};
  if(bytes.subarray(0,4).equals(Buffer.from([0xff,0xfe,0,0]))||bytes.subarray(0,4).equals(Buffer.from([0,0,0xfe,0xff])))fail('Convert UTF-32 data to UTF-8 before importing.');
  const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
  let text:string;try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{fail('CSV/TSV must use valid UTF-8 or BOM-marked UTF-16.');}
  let field='',quoted=false,closed=false;
  const finish=()=>{if(field.trimStart().startsWith('='))fail('CSV/TSV contains formula fields. Import literal data only; use explicit reviewed formula edits separately.');field='';closed=false;};
  for(let i=0;i<text!.length;i++){
    const char=text![i];if(char==='\0')fail('NUL characters are not supported in imported text.');
    if(quoted){if(char==='"'){if(text![i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=char;}
    else if(char===delimiter||char==='\r'||char==='\n')finish();
    else if(char==='"'){if(field.trim()||closed)fail('Malformed quoted field; nothing was imported.');quoted=true;}
    else{if(closed&&!/\s/.test(char))fail('Unexpected text after a quoted field.');field+=char;}
    if(field.length>32767)fail('A field exceeds the Excel cell text limit.');
  }
  if(quoted)fail('Unclosed quoted field; nothing was imported.');finish();
}
