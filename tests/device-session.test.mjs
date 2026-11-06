import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const manager=join(here,'..','image','config','includes.chroot','usr','local','bin','southbag-device-session');
const fixtures=join(here,'fixtures','bin');
// Fixture shims land 644 in web-published checkouts and the manager execs
// them directly, so provision executable copies per run instead of trusting
// tree modes (build.sh owns image-level normalization; tests must not
// depend on it having run first).
function shimBin(base){
 const dir=join(base,'shim-bin');mkdirSync(dir);
 for(const f of ['systemd-run','systemctl']){
  const dst=join(dir,f);
  writeFileSync(dst,readFileSync(join(fixtures,f)));
  chmodSync(dst,0o755);
 }
 return dir;
}
// Contract tests run the manager against fixture systemd-run/systemctl shims.
// Scope semantics (cgroup retention of setsid descendants) are image-proven,
// not emulated here.
function setup(){
 const base=mkdtempSync(join(tmpdir(),'device-session-'));
 const state=join(base,'state'),root=join(state,'device-session');
 mkdirSync(root,{recursive:true});
 mkdirSync(join(base,'systemd'),{recursive:true});
 mkdirSync(join(base,'cgroup'),{recursive:true});
 const shim=shimBin(base);
 const env={...process.env,
  SOUTHBAG_STATE_DIR:state,
  SOUTHBAG_DEVICE_SYSTEMD_RUN:join(shim,'systemd-run'),
  SOUTHBAG_DEVICE_SYSTEMCTL:join(shim,'systemctl'),
  SOUTHBAG_DEVICE_CGROUP_ROOT:join(base,'cgroup'),
  SOUTHBAG_DEVICE_START_DEADLINE:'3',
  SOUTHBAG_DEVICE_STOP_DEADLINE:'3',
  FAKE_SYSTEMD_STATE:join(base,'systemd')};
 const call=(...args)=>spawnSync('sh',[manager,...args],{env,encoding:'utf8',timeout:30000});
 return {base,state,root,env,call};
}
function seedAccount(root,state,generation='one'){
 writeFileSync(join(root,'generation'),generation);
 writeFileSync(join(state,'account'),'sub\temail\n');
}
test('launch gating: refused without account, with blocked flag, for unknown app, and shell refused while blocked',()=>{
 const {base,root,state,call}=setup();
 try{
  assert.notEqual(call('launch','browser','sleep','30').status,0,'no account');
  seedAccount(root,state);
  assert.notEqual(call('launch','nonsense','sleep','30').status,0,'unknown app');
  writeFileSync(join(root,'blocked'),'');
  assert.notEqual(call('launch','browser','sleep','30').status,0,'blocked launch');
  assert.notEqual(call('shell').status,0,'blocked shell');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('reset stops tracked scopes, clears only owned profiles, rejects stale generation',()=>{
 const {base,state,root,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  writeFileSync(join(state,'settings'),'keep');
  assert.equal(call('launch','browser','sleep','30').status,0,'launch tracked');
  const notes=readdirSync(root).filter(f=>f.startsWith('app-browser-')&&f.endsWith('.unit'));
  assert.equal(notes.length,1,'scope note recorded');
  assert.match(readFileSync(join(root,notes[0]),'utf8'),/^southbag-device-app-browser-\d+\.scope/);
  assert.notEqual(call('reset','stale').status,0,'stale generation refused');
  assert.equal(existsSync(join(root,'browser','cookie')),true,'nothing wiped on stale reset');
  assert.equal(call('reset','one').status,0,'reset accepted');
  assert.equal(existsSync(join(state,'account')),false);
  assert.equal(existsSync(join(root,'browser')),false,'private profile wiped');
  assert.equal(readFileSync(join(state,'settings'),'utf8'),'keep','unrelated state preserved');
  assert.equal(existsSync(join(root,'generation')),false,'generation cleared');
  assert.equal(existsSync(join(root,'blocked')),false,'unblocked after clean reset');
  assert.notEqual(call('launch','browser','sleep','30').status,0,'launch refused after reset');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('bounded stop failure fails closed: blocked kept, profiles kept, note kept for retry',()=>{
 const {base,state,root,env,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  assert.equal(call('launch','browser','sleep','30').status,0);
  writeFileSync(join(env.FAKE_SYSTEMD_STATE,'hang-stop'),'');
  assert.notEqual(call('reset','one').status,0,'reset must fail when stop hangs');
  assert.equal(existsSync(join(root,'blocked')),true,'stays blocked');
  assert.equal(existsSync(join(state,'account')),false,'account still removed first');
  assert.equal(existsSync(join(root,'browser','cookie')),true,'profile not wiped');
  assert.equal(readdirSync(root).filter(f=>f.endsWith('.unit')).length,1,'note kept for retry');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('stale populated cgroup gate: stopped unit with populated writers fails closed',()=>{
 const {base,state,root,env,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  const unit='southbag-device-app-browser-999.scope';
  writeFileSync(join(root,'app-browser-999.unit'),unit+'\n');
  mkdirSync(join(env.FAKE_SYSTEMD_STATE,'units'),{recursive:true});
  writeFileSync(join(env.FAKE_SYSTEMD_STATE,'units',unit+'.pid'),'999999\n');
  mkdirSync(join(env.SOUTHBAG_DEVICE_CGROUP_ROOT,'units',unit),{recursive:true});
  writeFileSync(join(env.SOUTHBAG_DEVICE_CGROUP_ROOT,'units',unit,'cgroup.events'),'populated 1\nfrozen 0\n');
  assert.notEqual(call('reset','one').status,0,'populated cgroup refuses wipe');
  assert.equal(existsSync(join(root,'blocked')),true);
  assert.equal(existsSync(join(root,'browser','cookie')),true);
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('failed start never leaves an untracked scope behind',()=>{
 const {base,state,root,env,call}=setup();
 try{
  seedAccount(root,state);
  writeFileSync(join(env.FAKE_SYSTEMD_STATE,'hang-start'),'');
  assert.notEqual(call('launch','browser','sleep','30').status,0,'start without ready marker fails');
  assert.equal(readdirSync(root).filter(f=>f.endsWith('.unit')||f.endsWith('.ready')).length,0,'no unit or ready debris');
  const leftover=readdirSync(join(env.FAKE_SYSTEMD_STATE,'units'));
  assert.equal(leftover.length,0,'half-started unit cleaned up: '+leftover);
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('escaped writer holding the private profile fails reset closed',async()=>{
 const {base,state,root,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  // The tracked scope exits instantly; a setsid descendant escapes it and
  // keeps the private cookie file open. Scope stop succeeds; the writer scan
  // must still refuse the wipe.
  assert.equal(call('launch','browser','sh','-c','setsid sh -c "exec sleep 30" <"$1" & exit 0','sh',join(root,'browser','cookie')).status,0);
  assert.notEqual(call('reset','one').status,0,'escaped writer blocks wipe');
  assert.equal(existsSync(join(root,'blocked')),true);
  assert.equal(existsSync(join(root,'browser','cookie')),true,'cookie preserved');
 }finally{
  spawnSync('/usr/bin/pkill',['-KILL','-f','exec sleep 30']);
  rmSync(base,{recursive:true,force:true})}
});
test('ancestor process carrying the root path in its argv does not block reset',()=>{
 const {base,state,root,env}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  // Operator launch command lines legitimately mention the private root
  // (e.g. --user-data-dir=$root/browser). The reset caller's own ancestor
  // chain is not a live writer and must not trip the escaped-writer scan.
  const r=spawnSync('sh',['-c','exec sh "$1" reset "$2"',`wrapper ${root}/browser`,manager,'one'],{env,encoding:'utf8',timeout:30000});
  assert.equal(r.status,0,`reset through ancestor argv: ${r.stderr}`);
  assert.equal(existsSync(join(root,'browser')),false,'private profile wiped');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('ancestor holding an open fd under the root still fails reset closed',()=>{
 const {base,state,root,env}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  // The wrapper shell is an ancestor of the manager AND holds fd 9 open to a
  // file under the private root. Ancestor exemption covers argv only, never
  // a real open handle: reset must fail closed and keep everything.
  const r=spawnSync('sh',['-c','exec 9<"$3"; sh "$1" reset "$2"; exit $?','wrapper',manager,'one',join(root,'browser','cookie')],{env,encoding:'utf8',timeout:30000});
  assert.notEqual(r.status,0,'ancestor with open fd must block reset');
  assert.equal(existsSync(join(root,'browser','cookie')),true,'nothing wiped');
  assert.equal(existsSync(join(root,'blocked')),true,'blocked kept for retry');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('launch env chain: SOUTHBAG_OS reaches the scoped app and the launch CGI sets it',()=>{
 const {base,state,root,call}=setup();
 try{
  seedAccount(root,state);
  const marker=join(base,'marker');
  // Mirror the production CGI invocation: manager launch <app> env SOUTHBAG_OS=1 <cmd>.
  const r=call('launch','browser','env','SOUTHBAG_OS=1','sh','-c','printf \'%s:%s\' "$SOUTHBAG_OS" "$SOUTHBAG_DEVICE_GENERATION" >"$1"','sh',marker);
  assert.equal(r.status,0,'launch ok: '+r.stderr);
  const deadline=Date.now()+3000;
  while(!existsSync(marker)&&Date.now()<deadline) spawnSync('sh',['-c','sleep .1']);
  assert.equal(readFileSync(marker,'utf8'),'1:one','SOUTHBAG_OS and device generation reach the scoped process env');
  // Regression assert: every browser launch line in the production CGI must
  // inject SOUTHBAG_OS=1 through the manager. A launch without it silently
  // bypasses the Browser device guard and download policy.
  const cgi=readFileSync(join(here,'..','image','shell-extra','cgi-bin','launch'),'utf8');
  // Browser launches only: the cog shell is intentionally unmarked (it cannot
  // download at all, per the CGI comment).
  const lines=cgi.split('\n').filter(l=>l.includes('"$manager" launch')&&l.includes('"$southbag_browser"'));
  assert.ok(lines.length>=2,'browser and svc launch lines present');
  for(const l of lines) assert.ok(l.includes('env SOUTHBAG_OS=1'),'every browser launch injects SOUTHBAG_OS=1: '+l.trim());
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('HOME alignment: without SOUTHBAG_STATE_DIR the manager state lives under $HOME/.local/share/southbag',()=>{
 const base=mkdtempSync(join(tmpdir(),'device-session-home-'));
 try{
  const home=join(base,'home');mkdirSync(home,{recursive:true});
  const state=join(home,'.local','share','southbag'),root=join(state,'device-session');
  mkdirSync(join(base,'systemd'),{recursive:true});
  mkdirSync(join(base,'cgroup'),{recursive:true});
 const shim=shimBin(base);
  const env={...process.env,
   HOME:home,
   SOUTHBAG_DEVICE_SYSTEMD_RUN:join(shim,'systemd-run'),
   SOUTHBAG_DEVICE_SYSTEMCTL:join(shim,'systemctl'),
   SOUTHBAG_DEVICE_CGROUP_ROOT:join(base,'cgroup'),
   SOUTHBAG_DEVICE_START_DEADLINE:'3',
   SOUTHBAG_DEVICE_STOP_DEADLINE:'3',
   FAKE_SYSTEMD_STATE:join(base,'systemd')};
  delete env.SOUTHBAG_STATE_DIR;
  const call=(...args)=>spawnSync('sh',[manager,...args],{env,encoding:'utf8',timeout:30000});
  assert.notEqual(call('launch','browser','sleep','30').status,0,'no account yet');
  seedAccount(root,state,'gen-home');
  assert.equal(call('launch','browser','sleep','30').status,0,'launch through HOME-derived state');
  const notes=readdirSync(root).filter(f=>f.startsWith('app-browser-')&&f.endsWith('.unit'));
  assert.equal(notes.length,1,'scope note under the HOME-derived root');
  assert.equal(call('reset','gen-home').status,0,'reset through HOME-derived state');
  assert.equal(existsSync(join(state,'account')),false,'account cleared');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('recovery surface: gated on blocked+generation, volatile profile, reset still completes',()=>{
 const {base,state,root,env,call}=setup();
 try{
  seedAccount(root,state);
  assert.notEqual(call('recovery').status,0,'recovery refused when not blocked');
  // Mid-reset crash state (fault injection): blocked set, account removed,
  // generation kept - exactly the manager's first two reset steps.
  writeFileSync(join(root,'blocked'),'');
  rmSync(join(state,'account'));
  const cog=join(base,'cog-standin');writeFileSync(cog,'#!/bin/sh\nexec sleep 31\n');chmodSync(cog,0o755);
  env.SOUTHBAG_DEVICE_COG=cog;
  env.XDG_RUNTIME_DIR=join(base,'run');
  const r=call('recovery');
  assert.equal(r.status,0,'recovery allowed while blocked: '+r.stderr);
  assert.equal(readdirSync(root).filter(f=>f==='recovery.unit').length,1,'recovery scope tracked');
  assert.equal(existsSync(join(root,'recovery-data')),false,'no recovery profile under the wiped root');
  // The interrupted reset retries cleanly while the recovery surface runs:
  // its volatile tmpfs profile never trips the escaped-writer scan.
  assert.equal(call('reset','one').status,0,'reset retry succeeds');
  assert.equal(existsSync(join(root,'blocked')),false,'unblocked after verified cleanup');
  assert.equal(existsSync(join(root,'generation')),false,'generation cleared');
  // The reset leaves the surface it was triggered from ALIVE: its renderer
  // profile is volatile tmpfs outside the wiped root, and the supervisor
  // retires it once the HTTP answer has landed. Tearing it down mid-reset
  // is what made the page's outcome states unreachable in the real UI.
  assert.equal(existsSync(join(root,'recovery.unit')),true,'recovery surface survives its own reset');
 }finally{
  spawnSync('/usr/bin/pkill',['-KILL','-f','sleep 31']);
  rmSync(base,{recursive:true,force:true})}
});
test('concurrent reset retries serialize on the session lock; exactly one succeeds',()=>{
 const {base,state,root,env}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  writeFileSync(join(root,'blocked'),'');
  rmSync(join(state,'account'));
  // Two Finish-cleanup clicks at once: the manager flock serializes them;
  // the loser sees the generation already gone and fails fast. Final state
  // must be the clean post-reset state, never a partial wipe.
  const a=spawnSync('sh',[manager,'reset','one'],{env,encoding:'utf8',timeout:30000});
  const b=spawnSync('sh',[manager,'reset','one'],{env,encoding:'utf8',timeout:30000});
  const rc=[a.status,b.status].sort();
  assert.deepEqual(rc,[0,1],'one succeeds, one fails');
  assert.equal(existsSync(join(root,'browser')),false,'profile wiped exactly once');
  assert.equal(existsSync(join(root,'blocked')),false,'unblocked');
  assert.equal(existsSync(join(root,'generation')),false,'generation cleared');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('crash-torn empty unit note retires by filename-derived unit; reset completes',()=>{
 const {base,state,root,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  assert.equal(call('launch','browser','sleep','30').status,0,'launch tracked');
  const notes=readdirSync(root).filter(f=>f.startsWith('app-browser-')&&f.endsWith('.unit'));
  assert.equal(notes.length,1);
  writeFileSync(join(root,notes[0]),''); // torn write: 0 bytes, as seen after hard kill
  assert.equal(call('reset','one').status,0,'torn note must not wedge reset');
  assert.equal(existsSync(join(root,'browser')),false,'profile wiped');
  assert.equal(existsSync(join(root,'blocked')),false,'unblocked');
  assert.equal(readdirSync(root).filter(f=>f.endsWith('.unit')).length,0,'notes retired');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('contradicting note content, bad name, or symlink note fails closed and keeps state',()=>{
 const {base,state,root,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  assert.equal(call('launch','browser','sleep','30').status,0);
  const notes=readdirSync(root).filter(f=>f.startsWith('app-browser-')&&f.endsWith('.unit'));
  writeFileSync(join(root,notes[0]),'southbag-device-impostor.scope\n');
  assert.notEqual(call('reset','one').status,0,'contradicting content refused');
  assert.equal(existsSync(join(root,'browser','cookie')),true,'profile kept');
  assert.equal(existsSync(join(root,'blocked')),true,'stays blocked');
  rmSync(join(root,notes[0]));
  writeFileSync(join(root,'app-bad_name.unit'),'');
  assert.notEqual(call('reset','one').status,0,'unsafe note name refused');
  rmSync(join(root,'app-bad_name.unit'));
  
  symlinkSync('/tmp/nowhere',join(root,'shell.unit'));
  assert.notEqual(call('reset','one').status,0,'symlink note refused');
 }finally{rmSync(base,{recursive:true,force:true})}
});
test('orphan live scope without a note is stopped by live enumeration during reset',()=>{
 const {base,state,root,env,call}=setup();
 try{
  seedAccount(root,state);
  mkdirSync(join(root,'browser'));writeFileSync(join(root,'browser','cookie'),'private');
  assert.equal(call('launch','browser','sleep','30').status,0);
  for(const f of readdirSync(root).filter(f=>f.endsWith('.unit'))) rmSync(join(root,f)); // notes lost
  assert.equal(call('reset','one').status,0,'reset completes via live enumeration');
  const left=readdirSync(join(env.FAKE_SYSTEMD_STATE,'units')).filter(f=>f.endsWith('.pid'));
  assert.equal(left.length,0,'orphan scope stopped');
  assert.equal(existsSync(join(root,'browser')),false,'profile wiped');
 }finally{rmSync(base,{recursive:true,force:true})}
});
