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
 for(const p of ['pages.yml','packages.yml','iso.yml']) {
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
