import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('fresh OAuth self-status, generation and private state contracts',()=>{
 const r=spawnSync('python3',[fileURLToPath(new URL('./account-status.test.py',import.meta.url))],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);
});
