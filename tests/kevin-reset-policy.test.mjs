import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../image/config/includes.chroot/usr/local/bin/southbag-device-session',import.meta.url),'utf8');
test('all-fields reset blocks before account/profile wipe if input stop fails, never requests restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kevin-reset-'));
 try {
  const state=join(dir,'state'),root=join(state,'device-session');mkdirSync(root,{recursive:true});
  const policy=join(dir,'policy'),script=join(dir,'reset'),client=join(dir,'client'),log=join(dir,'client.log');
  writeFileSync(script,source.replace('policy=/etc/southbag/kevin-all-fields','policy='+policy));
  writeFileSync(policy,'kevin=all-fields\n');chmodSync(policy,0o644);
  writeFileSync(client,'#!/bin/sh\necho "$*" >> "$CLIENT_LOG"\ncase "$1" in current) echo "generation=7 state=inhibited";; inhibit) exit "${STOP_RESULT:-0}";; *) exit 3;; esac\n');chmodSync(client,0o755);
  const env={...process.env,SOUTHBAG_STATE_DIR:state,SOUTHBAG_DEVICE_INPUT_CLIENT:client,CLIENT_LOG:log};
  for(const mode of ['fail','pass']) {
   writeFileSync(join(state,'account'),'fixture\n');writeFileSync(join(root,'generation'),'fixture-generation\n');mkdirSync(join(root,'browser'),{recursive:true});writeFileSync(join(root,'browser','cookie'),'private');
   const r=spawnSync('unshare',['--user','--map-root-user','sh',script,'reset','fixture-generation'],{env:{...env,STOP_RESULT:mode==='fail'?'1':'0',SOUTHBAG_DEVICE_SYSTEMCTL:'/bin/true'},encoding:'utf8',timeout:10000});
   assert.equal(r.status,mode==='fail'?1:0,r.stderr);
   assert.equal(existsSync(join(root,'browser','cookie')),mode==='fail');
   assert.equal(existsSync(join(state,'account')),mode==='fail');
   assert.equal(existsSync(join(root,'blocked')),mode==='fail');
  }
  assert.equal(readFileSync(log,'utf8'),'current\ninhibit 7\ncurrent\ninhibit 7\n');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
