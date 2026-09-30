import type { Operation } from './index.ts';

// Full before/after matrices remain in the local operation journal, not every model turn.
export function writeToolResult(operation: Operation) {
  const result = operation.result as any;
  const payload = operation.payload as any;
  return {
    operationId: operation.id,
    status: operation.status,
    sheet: payload?.sheet,
    range: payload?.range,
    verified: operation.status === 'applied' && result?.verified === true,
    revision: result?.revision,
    code: result?.code,
    message: result?.message,
    ...(operation.status === 'conflict' ? { instruction: 'Reread the target before deciding a new operation; a frozen selection requires a new explicit reference.' } : {}),
    ...(operation.status === 'unknown' ? { instruction: 'Inspect the current target. Do not blindly retry.' } : {}),
  };
}
