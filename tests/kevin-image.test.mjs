import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('normal image uses exact CI input and cannot mix diagnostic lanes',()=>{
 const iso=read('.github/workflows/iso.yml'),build=read('image/build.sh'),stage=read('packaging/stage-kevin-image.sh'),hook=read('image/config/hooks/normal/0014-kevin-install.hook.chroot');
 assert.match(iso,/run-id: 42929287076/);
 assert.match(iso,/name: kevin-source-candidate/);
 assert.match(build,/Cannot mix worker lanes/);
 assert.match(build,/stage-kevin-image.sh/);
 for(const s of [stage,hook])assert.match(s,/e75fe8dba441f1543d618bd541e61eef660b788584f677a8189b74132b01cefe/);
 assert.match(hook,/systemctl enable southbag-espanso-boot.service/);
 assert.doesNotMatch(hook,/systemctl start/);
 assert.match(iso,/source_assets=/);
 assert.match(iso,/sha256sum southbag-os.iso southbag-inject_\*_source.tar.gz/);
});
test('browser pin agrees across image and update channel',()=>{
 for(const p of ['image/build.sh','.github/workflows/pages.yml','.github/workflows/packages.yml'])assert.match(read(p),/SOUTHBAG_BROWSER_VERSION[=:] ?"v1.1.0"/);
});
