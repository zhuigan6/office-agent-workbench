import type {CapturedSelection} from '../../../packages/contracts/selection.ts';

export function selectionPreviewText(selection:CapturedSelection){
  if(selection.kind==='powerpoint')return selection.preview.replace(/\r\n?/g,'\n').replace(/\u000b/g,'\n');
  if(selection.kind!=='word')return selection.preview;
  // Display cell/row markers as a grid, without altering the frozen tool payload.
  return (selection.table?selection.preview.replace(/\r\u0007\r\u0007/g,'\n').replace(/\r\u0007/g,'\t'):selection.preview).replace(/\r\n?/g,'\n');
}
