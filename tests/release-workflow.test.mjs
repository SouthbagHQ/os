import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/iso.yml',import.meta.url),'utf8');
test('release is explicit, main-only and refuses diagnostic images',()=>{
 assert.match(workflow,/publish_release:[\s\S]*?default: false/);
 assert.match(workflow,/GITHUB_REPOSITORY.*SouthbagHQ\/os/);
 assert.match(workflow,/GITHUB_REF.*refs\/heads\/main/);
 assert.match(workflow,/DORMANT.*false/);
});
test('release waits for successful build and positive boot evidence',()=>{
 assert.match(workflow,/needs: build/);
 assert.match(workflow,/BOOT_READY: \$\{\{ needs.build.outputs.boot_ready \}\}/);
 assert.match(workflow,/BOOT_READY.*true/);
 assert.match(workflow,/ready=true.*GITHUB_OUTPUT/);
});
test('release checksums downloaded image and refuses existing tags',()=>{
 assert.match(workflow,/sha256sum --check SHA256SUMS/);
 assert.match(workflow,/git\/ref\/tags\/\$RELEASE_TAG/);
 assert.match(workflow,/gh release create.*southbag-os.iso SHA256SUMS/);
 assert.doesNotMatch(workflow,/--clobber|--force/);
});
test('write permission is confined to release job',()=>{
 const [build,release]=workflow.split('\n  release:\n');
 assert.doesNotMatch(build,/contents: write/);
 assert.match(release,/contents: write/);
 assert.match(release,/cancel-in-progress: false/);
});

import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const crashGate=workflow.slice(workflow.indexOf('          if grep -Eq'),workflow.indexOf('          if grep -q "SOUTHBAG-OS-READY"')).split('\n').map(x=>x.replace(/^          /,'')).join('\n');
for(const [label,log,passes] of [
 ['stable','SOUTHBAG-OS-STABLE\nSOUTHBAG-OS-READY\n',true],
 ['renderer crash after ready','SOUTHBAG-OS-STABLE\nSOUTHBAG-OS-READY\nllvmpipe-1: segfault at deadbeef\n',false],
 ['kernel panic','SOUTHBAG-OS-STABLE\nKernel panic - not syncing\n',false],
 ['restart loop','SOUTHBAG-OS-STABLE\nSOUTHBAG-OS-READY\nSOUTHBAG-OS-UNSTABLE\n',false],
 ['no sustained health marker','SOUTHBAG-OS-READY\n',false],
]) test('sustained smoke '+label+' is '+(passes?'accepted':'rejected'),()=>{
 const dir=mkdtempSync(join(tmpdir(),'release-smoke-'));
 try{writeFileSync(join(dir,'serial.log'),log);const r=spawnSync('bash',['-c',crashGate],{cwd:dir,encoding:'utf8'});assert.equal(r.status===0,passes,r.stdout+r.stderr);}
 finally{rmSync(dir,{recursive:true,force:true});}
});

const readiness=readFileSync(new URL('../image/config/includes.chroot/usr/local/bin/southbag-ready',import.meta.url),'utf8');
test('system readiness proves a minute of unchanged compositor and shell',()=>{
 assert.match(readiness,/while :; do/);assert.match(readiness,/if \[ "\$i" -eq 60 \]/);
 assert.match(readiness,/pidof labwc\)" != "\$compositor"/);
 assert.match(readiness,/pidof cog\)" != "\$shell"/);
 assert.match(readiness,/\|\| ! assets_up/);
 assert.match(readiness,/SOUTHBAG-OS-UNSTABLE/);
 assert.match(readiness,/SOUTHBAG-OS-STABLE/);
 assert.match(workflow,/-cpu qemu64/);assert.match(workflow,/-vga std/);
});

test('readiness is an ongoing service, not a timed-out oneshot',()=>{
 const unit=readFileSync(new URL('../image/config/includes.chroot/etc/systemd/system/southbag-ready.service',import.meta.url),'utf8');
 assert.match(unit,/Type=simple/);assert.doesNotMatch(unit,/Type=oneshot/);
});
