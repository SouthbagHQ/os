import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const lock=join(here,'..','image','config','includes.chroot','usr','local','bin','southbag-lock');
const broker=join(here,'..','image','config','includes.chroot','usr','local','sbin','southbag-input-broker');
const fixtures=join(here,'fixtures','bin');
// The lock's barrier gating, end to end: real lock script, real broker,
// fixture systemctl, recording lock-surface shim.
function setup(){
 const base=mkdtempSync(join(tmpdir(),'lock-inhibit-'));
 const state=join(base,'state'),bstate=join(base,'broker-state'),fake=join(base,'systemd'),cgroot=join(base,'cgroup');
 const shim=join(base,'shim-bin');
 for(const d of [state,bstate,join(fake,'units'),join(cgroot,'units'),shim]) mkdirSync(d,{recursive:true});
 writeFileSync(join(shim,'systemctl'),readFileSync(join(fixtures,'systemctl')));
 // The broker is exercised as an executable: copy it beside the shims and
 // chmod it, so the test does not depend on the git checkout's exec bit.
 writeFileSync(join(shim,'broker'),readFileSync(broker));
 chmodSync(join(shim,'broker'),0o755);
 const surface=join(shim,'surface');
 writeFileSync(surface,'#!/bin/sh\necho invoked >>"$SURFACE_LOG"\n');
 chmodSync(join(shim,'systemctl'),0o755);
 chmodSync(surface,0o755);
 writeFileSync(join(state,'account'),'sub\temail\n');
 const slog=join(base,'surface.log');
 const env={...process.env,
  SOUTHBAG_STATE_DIR:state,
  SOUTHBAG_LOCK_BROKER:join(shim,'broker'),
  SOUTHBAG_LOCK_SURFACE:surface,
  SURFACE_LOG:slog,
  SOUTHBAG_BROKER_SYSTEMCTL:join(shim,'systemctl'),
  SOUTHBAG_BROKER_CGROUP_ROOT:cgroot,
  SOUTHBAG_BROKER_STATE:bstate,
  SOUTHBAG_BROKER_STOP_DEADLINE:'3',
  SOUTHBAG_BROKER_ALLOW_NONROOT:'1',
  SOUTHBAG_DEVICE_CGROUP_ROOT:cgroot,
  FAKE_SYSTEMD_STATE:fake};
 const call=(a=[])=>spawnSync('sh',[lock,...a],{env,encoding:'utf8',timeout:20000});
 const bcall=(...a)=>spawnSync('sh',[broker,...a],{env,encoding:'utf8',timeout:20000});
 return {base,state,fake,cgroot,env,slog,call,bcall};
}
function seedRunning(fake,cgroot){
 const unit='southbag-espanso.service';
 const cg=join(cgroot,'units',unit);mkdirSync(cg,{recursive:true});
 const p=spawn('sleep',['300'],{stdio:'ignore'});
 writeFileSync(join(fake,'units',unit+'.pid'),String(p.pid));
 writeFileSync(join(cg,'cgroup.events'),'populated 1\nfrozen 0\n');
 return p;
}

test('barrier ok: prompt is presented and the worker is stopped first',async()=>{
 const {base,state,fake,cgroot,slog,call,bcall}=setup();
 try{
  bcall('begin-generation');
  const worker=seedRunning(fake,cgroot);
  const exited=once(worker,'exit');
  const r=call();
  assert.equal(r.status,0,r.stderr);
  await exited;
  assert.match(readFileSync(slog,'utf8'),/invoked/);
  assert.ok(existsSync(join(state,'locked')),'locked flag written after the barrier');
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('barrier failure fails closed: no prompt, no locked flag',async()=>{
 const {base,state,fake,cgroot,slog,call,bcall}=setup();
 try{
  bcall('begin-generation');
  const worker=seedRunning(fake,cgroot);
  const exited=once(worker,'exit');
  writeFileSync(join(fake,'hang-stop'),'');
  const r=call();
  assert.equal(r.status,1);
  assert.ok(!existsSync(slog),'no credential prompt while the worker may still run');
  assert.ok(!existsSync(join(state,'locked')),'no locked flag without the prompt');
  assert.equal(worker.exitCode,null,'worker survived the hung stop');
  rmSync(join(fake,'hang-stop'));
  const r2=call();
  assert.equal(r2.status,0,'a later lock with a clean barrier proceeds');
  await exited;
  assert.match(readFileSync(slog,'utf8'),/invoked/);
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('non-executable broker with a begun generation fails closed: no prompt, worker untouched',async()=>{
 const {base,state,fake,cgroot,slog,call,bcall}=setup();
 try{
  bcall('begin-generation');
  const worker=seedRunning(fake,cgroot);
  const exited=once(worker,'exit');
  chmodSync(join(base,'shim-bin','broker'),0o644); // the web-upload/legacy-loss case
  const r=call();
  assert.equal(r.status,1,'no prompt while a brokered worker may be live');
  assert.ok(!existsSync(slog),'no credential prompt without the barrier');
  assert.ok(!existsSync(join(state,'locked')),'no locked flag');
  assert.equal(worker.exitCode,null,'worker left running; the lock never touches it');
  worker.kill('SIGKILL');await exited;
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('absent broker with a recorded begun generation fails closed',()=>{
 const {base,state,env,slog}=setup();
 try{
  writeFileSync(join(env.SOUTHBAG_BROKER_STATE,'generation'),'1\n');
  const r=spawnSync('sh',[lock],{env:{...env,SOUTHBAG_LOCK_BROKER:join(base,'no-such-broker')},encoding:'utf8',timeout:20000});
  assert.equal(r.status,1,'no prompt: the broker that owns the worker cannot run');
  assert.ok(!existsSync(slog),'no credential prompt');
  assert.ok(!existsSync(join(state,'locked')),'no locked flag');
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('broken broker (current errors) fails closed before any prompt',()=>{
 const {base,state,slog,call}=setup();
 try{
  const shim=join(base,'shim-bin','broker');
  writeFileSync(shim,'#!/bin/sh\nexit 1\n');
  chmodSync(shim,0o755);
  const r=call();
  assert.equal(r.status,1,'no prompt when the broker cannot report a generation');
  assert.ok(!existsSync(slog),'no credential prompt');
  assert.ok(!existsSync(join(state,'locked')),'no locked flag');
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('absent broker (legacy image) does not block the lock',()=>{
 const {base,env,slog,call}=setup();
 try{
  const r=spawnSync('sh',[lock],{env:{...env,SOUTHBAG_LOCK_BROKER:join(env.SOUTHBAG_STATE_DIR,'no-such-broker')},encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr);
  assert.match(readFileSync(slog,'utf8'),/invoked/);
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('broker present but never begun (generation 0): nothing brokered, lock proceeds',()=>{
 const {base,slog,call}=setup();
 try{
  const r=call();
  assert.equal(r.status,0,r.stderr);
  assert.match(readFileSync(slog,'utf8'),/invoked/);
 }finally{rmSync(base,{recursive:true,force:true})}
});
