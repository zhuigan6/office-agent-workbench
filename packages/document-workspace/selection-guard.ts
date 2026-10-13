import {AppError} from '../contracts/index.ts';
import type {CapturedSelection} from '../contracts/selection.ts';
import type {DatabaseSync} from 'node:sqlite';

// One active message context per conversation. Unknown sends remain restricted
// until a subsequent user message explicitly establishes a different context.
export class SelectionGuard{
  private scopes=new Map<string,{id:string;kind:CapturedSelection['kind']}>();
  constructor(private db?:DatabaseSync){
    if(db){
      db.exec('CREATE TABLE IF NOT EXISTS selection_guards (conversation TEXT PRIMARY KEY, selection_id TEXT NOT NULL, kind TEXT NOT NULL)');
      for(const row of db.prepare('SELECT * FROM selection_guards').all() as {conversation:string;selection_id:string;kind:CapturedSelection['kind']}[]){
        if(!['word','excel','excel-chart','powerpoint','powerpoint-slides'].includes(row.kind))throw new AppError('SELECTION_GUARD_STATE','Stored selection restriction is invalid.');
        this.scopes.set(row.conversation,{id:row.selection_id,kind:row.kind});
      }
    }
  }
  set(conversation:string,selection?:{id:string;kind:CapturedSelection['kind']}){
    if(selection)this.db?.prepare('INSERT INTO selection_guards VALUES(?,?,?) ON CONFLICT(conversation) DO UPDATE SET selection_id=excluded.selection_id,kind=excluded.kind').run(conversation,selection.id,selection.kind);
    else this.db?.prepare('DELETE FROM selection_guards WHERE conversation=?').run(conversation);
    if(selection)this.scopes.set(conversation,{...selection});else this.scopes.delete(conversation);
  }
  assert(conversation:string,route:string,payload:Record<string,unknown>){
    const scope=this.scopes.get(conversation);if(!scope)return;
    if(['/tools/capabilities','/tools/read','/tools/read-text','/tools/shapes','/tools/tables','/tools/table-layout-read','/tools/excel-tables','/tools/excel-sheets','/tools/excel-charts'].includes(route))return;
    if(scope.kind==='excel-chart'&&route==='/tools/excel-chart-layout'&&payload.selectionId===scope.id)return;
    if(scope.kind==='excel'&&['/tools/excel-range-format','/tools/excel-range-format-read'].includes(route)&&payload.selectionId===scope.id)return;
    if(scope.kind==='excel'&&route==='/tools/excel-table-create'&&payload.selectionId===scope.id)return;
    if(scope.kind==='excel'&&route==='/tools/excel-table-columns'&&payload.selectionId===scope.id)return;
    if(route==='/tools/file'&&['list','help','inspect'].includes(String(payload.action)))return;
    const permitted=scope.kind==='excel'?['/tools/write-selection','/tools/excel-table-style','/tools/excel-table-rows','/tools/excel-chart-create']:scope.kind==='word'?['/tools/format-selection','/tools/replace-selection','/tools/paragraph-batch','/tools/table-batch','/tools/table-layout','/tools/table-rows']:scope.kind==='powerpoint'?['/tools/format-selection','/tools/layout-selection','/tools/replace-selection']:[];
    if(!permitted.includes(route)||payload.selectionId!==scope.id)throw new AppError('SELECTION_LOCKED','This message is restricted to its frozen selection. Use the matching selection tool, or send a new explicit user request without that reference.',409);
  }
}
