import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('Word/Excel duplicate COM proxies retain one real document while independent windows stay distinct',{skip:process.platform!=='win32'},()=>{
  const r=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('../scripts/Verify-DiscoveryIdentity.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/DISCOVERY_WINDOW_IDENTITY=PASS/);
});
