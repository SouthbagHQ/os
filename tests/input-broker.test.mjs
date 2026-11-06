import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const broker=join(here,'..','image','config','includes.chroot','usr','local','sbin','southbag-input-broker');
import {chmodSync} from 'node:fs';
const fixtures=join(here,'fixtures','bin');
// Fixture shims land 644 in web-published checkouts and the broker execs them
// directly, so provision executable copies per run instead of trusting tree
// modes (build.sh owns image-level normalization; tests must not depend on
// it having run first).
function shimBin(base){
 const dir=join(base,'shim-bin');mkdirSync(dir);
 const dst=join(dir,'systemctl');
 writeFileSync(dst,readFileSync(join(fixtures,'systemctl')));
 chmodSync(dst,0o755);
 return dir;
}
// Contract tests run the broker against the shared fixture systemctl shim.
// Actual cgroup retention semantics are image-proven, not emulated here.
function setup(){
 const base=mkdtempSync(join(tmpdir(),'input-broker-'));
 const state=join(base,'broker-state'),fake=join(base,'systemd'),cgroot=join(base,'cgroup');
 mkdirSync(state,{recursive:true});
 mkdirSync(join(fake,'units'),{recursive:true});
 mkdirSync(join(cgroot,'units'),{recursive:true});
 const shim=shimBin(base);
 const env={...process.env,
  SOUTHBAG_BROKER_SYSTEMCTL:join(shim,'systemctl'),
  SOUTHBAG_BROKER_CGROUP_ROOT:cgroot,
  SOUTHBAG_BROKER_STATE:state,
  SOUTHBAG_BROKER_STOP_DEADLINE:'3',
  SOUTHBAG_BROKER_ALLOW_NONROOT:'1',
  SOUTHBAG_DEVICE_CGROUP_ROOT:cgroot,
  FAKE_SYSTEMD_STATE:fake};
 const call=(...a)=>spawnSync('sh',[broker,...a],{env,encoding:'utf8',timeout:20000});
 return {base,state,fake,cgroot,env,call};
}
function seedRunning(fake,cgroot){
 const unit='southbag-espanso.service';
 const cg=join(cgroot,'units',unit);mkdirSync(cg,{recursive:true});
 const p=spawn('sleep',['300'],{stdio:'ignore'});
 writeFileSync(join(fake,'units',unit+'.pid'),String(p.pid));
 writeFileSync(join(cg,'cgroup.events'),'populated 1\nfrozen 0\n');
 return p;
}

test('boot default is inhibited and there is no activation verb',()=>{
 const {base,call}=setup();
 try{
  const st=call('current');
  assert.equal(st.status,0);
  assert.match(st.stdout,/generation=0 state=inhibited/);
  assert.equal(call('inhibit','0').status,1,'generation 0 never valid');
  for(const v of ['start','authorize-unlock','restart','enable']){
   const r=call(v,'0');
   assert.equal(r.status,2,`verb ${v} refused`);
   assert.match(r.stderr,/usage/);
  }
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('begin-generation increments monotonically; stale generations are rejected',()=>{
 const {base,state,call}=setup();
 try{
  assert.equal(call('begin-generation').stdout.trim(),'1');
  assert.equal(call('begin-generation').stdout.trim(),'2');
  assert.equal(readFileSync(join(state,'generation'),'utf8').trim(),'2');
  assert.equal(call('inhibit','1').status,1,'stale generation rejected');
  assert.equal(call('inhibit','2').status,0,'current generation accepted');
  const st=call('status','2');
  assert.equal(st.status,0);
  assert.match(st.stdout,/generation=2 state=inhibited/);
  const cur=call('current');
  assert.equal(cur.status,0);
  assert.match(cur.stdout,/generation=2 state=inhibited/);
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('begin-generation is root-only in the image default',()=>{
 const {base,env}=setup();
 try{
  const env2={...env};delete env2.SOUTHBAG_BROKER_ALLOW_NONROOT;
  // Host tests never run as root, so the default policy must refuse here.
  const r=spawnSync('sh',[broker,'begin-generation'],{env:env2,encoding:'utf8',timeout:20000});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/root-only/);
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('inhibit stops a running worker and proves its cgroup empty',async()=>{
 const {base,state,fake,cgroot,call}=setup();
 try{
  call('begin-generation');
  const worker=seedRunning(fake,cgroot);
  // A killed child is a zombie until reaped: await the exit, never kill -0.
  const exited=once(worker,'exit');
  const r=call('inhibit','1');
  assert.equal(r.status,0,r.stderr);
  assert.equal(readFileSync(join(state,'state'),'utf8').trim(),'inhibited');
  await exited;
  assert.match(readFileSync(join(cgroot,'units','southbag-espanso.service','cgroup.events'),'utf8'),/populated 0/);
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('a hung stop fails closed and never silently retries',async()=>{
 const {base,state,fake,cgroot,call}=setup();
 try{
  call('begin-generation');
  const worker=seedRunning(fake,cgroot);
  const exited=once(worker,'exit');
  writeFileSync(join(fake,'hang-stop'),'');
  const t0=Date.now();
  const r=call('inhibit','1');
  const dt=Date.now()-t0;
  assert.notEqual(r.status,0,'hung stop must not report readiness');
  assert.equal(readFileSync(join(state,'state'),'utf8').trim(),'failed');
  // Wall-clock deadline (3s here) bounds the barrier: it must engage well
  // before the 20s call timeout, proving expiry is not iteration-paced.
  assert.ok(dt>=2000&&dt<15000,'barrier must expire at the wall deadline (second-flooring shaves up to 1s), took '+dt+'ms');
  assert.equal(worker.exitCode,null,'worker survives the hung stop');
  assert.equal(worker.signalCode,null);
  rmSync(join(fake,'hang-stop'));
  // A killed stopper never inherits the broker lock fd (8>&-): a follow-up
  // verb must take the lock and answer promptly, not wedge behind it.
  const t1=Date.now();
  const r2=call('inhibit','1');
  assert.ok(Date.now()-t1<10000,'follow-up verb wedged behind a stranded lock');
  assert.equal(r2.status,0,'explicit later inhibit re-runs the barrier');
  assert.equal(readFileSync(join(state,'state'),'utf8').trim(),'inhibited');
  await exited;
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('a populated cgroup after stop fails closed',async()=>{
 const {base,state,fake,cgroot,call}=setup();
 try{
  call('begin-generation');
  const worker=seedRunning(fake,cgroot);
  const exited=once(worker,'exit');
  writeFileSync(join(fake,'stop-leaves-populated'),'');
  const r=call('inhibit','1');
  assert.notEqual(r.status,0,'populated cgroup must not report readiness');
  assert.equal(readFileSync(join(state,'state'),'utf8').trim(),'failed');
  await exited;
 }finally{rmSync(base,{recursive:true,force:true})}
});

test('a new generation inhibits first: a fresh session never inherits a running worker',async()=>{
 const {base,state,fake,cgroot,call}=setup();
 try{
  call('begin-generation');
  const worker=seedRunning(fake,cgroot);
  const exited=once(worker,'exit');
  const g=call('begin-generation');
  assert.equal(g.stdout.trim(),'2');
  await exited;
  assert.equal(readFileSync(join(state,'state'),'utf8').trim(),'inhibited');
 }finally{rmSync(base,{recursive:true,force:true})}
});
