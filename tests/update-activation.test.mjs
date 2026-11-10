import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('..',import.meta.url).pathname;
const read=p=>readFileSync(join(root,p),'utf8');
const run=(cmd,args,opts={})=>spawnSync(cmd,args,{encoding:'utf8',...opts});
test('package versions use full ancestry and sort forward, not hashes',()=>{
 const r=run('bash',['packaging/package-version.sh'],{cwd:root});
 assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/^0\.1\.0\+git\d{10}\n$/);
 assert.equal(run('dpkg',['--compare-versions','0.1.0+git0000000299','gt','0.1.0+git0000000298']).status,0);
 for(const p of ['pages.yml','packages.yml','iso.yml','ci.yml']) {
  const s=read('.github/workflows/'+p); assert.match(s,/fetch-depth: 0/);
  assert.doesNotMatch(s,/0\.1\.0\+\$\{GITHUB_SHA/);
 }
});
test('images install shell and lock packages before cleaning build inputs',()=>{
 const build=read('image/build.sh'); assert.match(build,/build-shell-deb\.sh/);
 const hook=read('image/config/hooks/normal/0016-lockd-build.hook.chroot');
 assert.match(hook,/SOUTHBAG_PREBUILT_ROOT=\/ bash/);
 assert.match(hook,/dpkg -i .*southbag-shell_.*southbag-lockd_/);
 assert.ok(hook.indexOf('dpkg -i')<hook.indexOf('rm -rf /opt/southbag-broker-src'));
 assert.match(read('packaging/build-lockd-deb.sh'),/SOUTHBAG_PREBUILT_ROOT/);
});
test('shell update contains its matching runtime and the public rotation key only',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'shell-package-test-'));
 try {
  const dist=join(tmp,'dist'),out=join(tmp,'out');mkdirSync(dist);writeFileSync(join(dist,'index.html'),'<h1>fixture</h1>');
  const r=run('bash',['packaging/build-shell-deb.sh','0.1.0+git0000000001',dist,out],{cwd:root});assert.equal(r.status,0,r.stderr);
  const deb=join(out,'southbag-shell_0.1.0+git0000000001_all.deb');
  const listing=run('dpkg-deb',['-c',deb]).stdout;
  for(const name of ['southbag-device-session','southbag-session','southbag-ready','southbag-analytics','southbag-shell','southbag-archive-keyring.gpg']) assert.ok(listing.includes(name),name);
  assert.ok(!listing.includes('private.asc')); assert.ok(!listing.includes('southbag-lockd'));
  const control=run('dpkg-deb',['-f',deb]).stdout;assert.match(control,/Package: southbag-shell/);
 } finally {rmSync(tmp,{recursive:true,force:true});}
});

test('channel remains hidden through build and is installed before apt timers at boot',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'channel-stage-test-'));
 try {
  const hook=read('image/config/hooks/normal/0026-southbag-updates.hook.chroot');
  for(const dir of ['root','usr/share/keyrings','etc/apt/sources.list.d','etc/systemd/system','bin']) mkdirSync(join(tmp,dir),{recursive:true});
  writeFileSync(join(tmp,'root/.southbag.sources.buildmask'),'Types: deb\nURIs: https://southbaghq.github.io/os/apt\nSigned-By: /usr/share/keyrings/southbag-archive-keyring.gpg\n');
  writeFileSync(join(tmp,'usr/share/keyrings/southbag-archive-keyring.gpg'),'public fixture');
  writeFileSync(join(tmp,'bin/systemctl'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  // Run the real hook's file operations inside a temporary filesystem fixture.
  const isolated=hook.replaceAll('/usr/share/',tmp+'/usr/share/').replaceAll('/etc/',tmp+'/etc/').replaceAll('/root/',tmp+'/root/');
  const r=run('sh',['-c',isolated],{env:{...process.env,PATH:join(tmp,'bin')+':'+process.env.PATH}});
  assert.equal(r.status,0,r.stderr);
  assert.equal(run('test',['-e',join(tmp,'etc/apt/sources.list.d/southbag.sources')]).status,1);
  assert.match(readFileSync(join(tmp,'usr/share/southbag-updates/southbag.sources'),'utf8'),/Signed-By:/);
  const unit=readFileSync(join(tmp,'etc/systemd/system/southbag-updates-channel.service'),'utf8');
  assert.match(unit,/DefaultDependencies=no/);assert.match(unit,/After=local-fs.target/);
  assert.match(unit,/Before=timers.target apt-daily.timer/);assert.match(unit,/WantedBy=timers.target/);
  // Without the key, remove staging and the channel service, not Debian timers.
  rmSync(join(tmp,'usr/share/keyrings/southbag-archive-keyring.gpg'));
  const absent=run('sh',['-c',isolated],{env:{...process.env,PATH:join(tmp,'bin')+':'+process.env.PATH}});
  assert.equal(absent.status,0,absent.stderr);
  assert.equal(run('test',['-e',join(tmp,'etc/systemd/system/southbag-updates-channel.service')]).status,1);
 } finally {rmSync(tmp,{recursive:true,force:true});}
});
