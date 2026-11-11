import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const broker=new URL('../image/config/includes.chroot/usr/local/sbin/southbag-input-broker',import.meta.url).pathname;
test('root boot start consumes one attempt before start; reset and generation changes do not rearm',()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-boot-'));
 try {
  const state=join(root,'state'),cg=join(root,'cg'),ctl=join(root,'ctl'),log=join(root,'log');mkdirSync(state);mkdirSync(cg);
  writeFileSync(ctl,'#!/bin/sh\necho "$*" >> "$CTL_LOG"\ncase "$1" in is-active) test -f "$FAKE_ROOT/active";; show) echo /fixture;; start) test -f "$SOUTHBAG_BROKER_STATE/boot-start-consumed" || exit 10; test ! -f "$FAKE_ROOT/fail-start" || exit 1; touch "$FAKE_ROOT/active";; stop) rm -f "$FAKE_ROOT/active";; *) exit 2;; esac\n');chmodSync(ctl,0o755);
  const env={...process.env,SOUTHBAG_BROKER_STATE:state,SOUTHBAG_BROKER_CGROUP_ROOT:cg,SOUTHBAG_BROKER_SYSTEMCTL:ctl,SOUTHBAG_BROKER_STOP_DEADLINE:'3',SOUTHBAG_BROKER_ALLOW_NONROOT:'1',FAKE_ROOT:root,CTL_LOG:log};
  const call=(...a)=>spawnSync('sh',[broker,...a],{env,encoding:'utf8',timeout:10000});
  assert.equal(call('boot-start').status,1,'no generation');
  assert.equal(call('begin-generation').status,0);
  assert.equal(call('boot-start').status,0);
  assert.match(call('current').stdout,/state=running/);
  assert.equal(call('inhibit','1').status,0);
  assert.equal(call('boot-start').status,1);
  assert.equal(call('begin-generation').status,0);
  assert.equal(call('boot-start').status,1,'new generation still same boot');
  assert.equal(readFileSync(log,'utf8').split('\n').filter(x=>x.startsWith('start ')).length,1);
  delete env.SOUTHBAG_BROKER_ALLOW_NONROOT;
  assert.match(call('boot-start').stderr,/root-only/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
