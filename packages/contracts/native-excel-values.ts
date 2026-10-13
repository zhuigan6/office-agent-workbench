import {canonical,type Cell} from './index.ts';
export function nativeExcelMatrixMatches(expected:Cell[][],actual:Cell[][],formula=false){
  const normalize=(matrix:Cell[][])=>matrix.map(row=>row.map(value=>value===null?'':formula&&typeof value==='number'?String(value):value));
  return canonical(normalize(expected))===canonical(normalize(actual));
}
