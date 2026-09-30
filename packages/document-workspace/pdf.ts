import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AppError} from '../contracts/index.ts';

export function pdfRange(args:unknown):{start:number;end:number} {
  if(args===undefined||Array.isArray(args)&&args.length===0)return {start:1,end:3};
  if(!Array.isArray(args)||args.length%2||args.length>4)throw new AppError('PDF_RANGE','Use --start and --end; at most five PDF pages per read.');
  let start=1,end:number|undefined;const seen=new Set<string>();
  for(let i=0;i<args.length;i+=2){
    const [flag,value]=[args[i],args[i+1]];
    if(!['--start','--end'].includes(flag)||seen.has(flag)||typeof value!=='string'||!/^\d{1,6}$/.test(value)||Number(value)<1)throw new AppError('PDF_RANGE','Page numbers must be positive integers.');
    seen.add(flag);if(flag==='--start')start=Number(value);else end=Number(value);
  }
  end ??=start+2;
  if(end<start||end-start>=5)throw new AppError('PDF_RANGE','Read between one and five PDF pages per request.');
  return {start,end};
}

export async function readPdf(filename:string,args?:unknown):Promise<any> {
  const range=pdfRange(args);
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--max-old-space-size=384',fileURLToPath(new URL('./pdf-worker.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='',settled=false;
    const fail=(code:string,message:string)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(new AppError(code,message,422));};
    const timer=setTimeout(()=>fail('PDF_TIMEOUT','PDF processing exceeded 20 seconds; use a smaller or simpler file.'),20000);
    child.on('error',()=>fail('PDF_UNAVAILABLE','The bundled PDF reader could not start.'));
    child.stdin.on('error',()=>fail('PDF_UNAVAILABLE','The PDF reader closed before accepting input.'));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',text=>{output+=text;if(output.length>200000)fail('PDF_LIMIT','PDF response exceeded the bounded output limit.');});
    child.on('close',code=>{
      if(settled)return;
      if(code!==0){fail('PDF_READ_FAILED','Cannot extract this PDF. It may be encrypted, damaged or exceed reader limits.');return;}
      try{const result=JSON.parse(output);settled=true;clearTimeout(timer);resolve(result);}catch{fail('PDF_RESPONSE','PDF reader returned an invalid response.');}
    });
    child.stdin.end(JSON.stringify({filename,...range}));
  });
}
