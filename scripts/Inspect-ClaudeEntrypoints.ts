import fs from 'node:fs/promises';
import path from 'node:path';
import {local} from '../apps/local-host/config.ts';
import {inspectClaudeEntrypoints} from '../packages/native-sessions/claude-runtime.ts';

const [binary,workspace]=process.argv.slice(2);
if(!binary||!workspace||process.argv.length!==4)throw Error('Supply the exact Claude executable and owned workspace as two arguments.');
const report=await inspectClaudeEntrypoints(binary,workspace),directory=await fs.mkdtemp(path.join(local,'verification/claude-entrypoints-'));
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),...report},null,2));
console.log(JSON.stringify({directory,...report}));
