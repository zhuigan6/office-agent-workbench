import {AppError} from '../contracts/index.ts';
export function inlineTableCsv(value:string){
  let quoted=false,result='';
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(c==='"'){
      if(quoted&&value[i+1]==='"'){result+='""';i++;continue;}
      quoted=!quoted;
    }
    result+=c===';'&&!quoted?'\n':c;
  }
  if(quoted)throw new AppError('INVALID_TABLE_DATA','Unclosed quote in inline table data.');
  return 'data:text/csv;base64,'+Buffer.from(result).toString('base64');
}
export function assetProperty(key:string,value:unknown):{id:string;prefix:string}|null {
  if(typeof value!=='string')return null;
  if(key.toLowerCase()==='data'){
    if(/^asset:/i.test(value))return assetProperty('src',value);
    if(/^(?:[a-z]:[\\/]|[\\/]|https?:|file:|data:|@|~[\\/])/i.test(value.trim()))throw new AppError('ASSET_REQUIRED','Data imports must reference an uploaded asset; inline table data must not be a filesystem or URL reference.');
    return null;
  }
  const paint=/^(background|fill|textfill)$/i.test(key)&&/^image:/i.test(value.trim());
  if(!paint&&!/src|source|file|image|uri|url|href|template|embed|^path$/i.test(key))return null;
  const token=paint?value.trim().slice(6):value;
  const match=/^asset:([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.exec(token);
  if(!match)throw new AppError('ASSET_REQUIRED','File-backed properties must use an uploaded asset:<fileId>; image fills use image:asset:<fileId>.');
  return {id:match[1],prefix:paint?'image:':''};
}
