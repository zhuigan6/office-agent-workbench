import {AppError,rangeDimensions} from '../contracts/index.ts';
export function importOptions(request:any){
  if(typeof request.dataFileId!=='string'||!/^[a-f0-9-]{36}$/i.test(request.dataFileId))throw new AppError('IMPORT_OPTIONS','Choose an uploaded CSV/TSV file ID, not a disk path.');
  if(typeof request.sheet!=='string'||!/^\/[^\[\]:\\/?*\x00-\x1f]{1,31}$/.test(request.sheet)||request.commands!==undefined)throw new AppError('IMPORT_OPTIONS','Choose a sheet path such as /Sheet1; do not mix import and batch commands.');
  const start=request.startCell??'A1';
  if(typeof start!=='string'||start.includes(':'))throw new AppError('IMPORT_OPTIONS','Use one starting cell.');
  rangeDimensions(start);
  if(request.header!==undefined&&typeof request.header!=='boolean')throw new AppError('IMPORT_OPTIONS','header must be boolean.');
  if(request.delimiter!==undefined&&![';',',','|','\t'].includes(request.delimiter))throw new AppError('IMPORT_OPTIONS','Delimiter must be comma, semicolon, pipe or a tab.');
  if(request.decimal!==undefined&&!['.',','].includes(request.decimal))throw new AppError('IMPORT_OPTIONS','Decimal mark must be dot or comma.');
  return ['--start-cell',start,...(request.header?['--header']:[]),...(request.delimiter!==undefined?['--delimiter',request.delimiter]:[]),...(request.decimal!==undefined?['--decimal',request.decimal]:[])];
}
