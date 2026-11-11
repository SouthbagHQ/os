import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('private Browser handoff export contracts (SQLite WAL, generation, account and cookie scope)',()=>{
 const r=spawnSync('python3',[fileURLToPath(new URL('./browser-session.test.py',import.meta.url))],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
