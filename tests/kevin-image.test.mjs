import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('normal image uses exact CI input and cannot mix diagnostic lanes',()=>{
 const iso=read('.github/workflows/iso.yml'),build=read('image/build.sh'),stage=read('packaging/stage-kevin-image.sh'),hook=read('image/config/hooks/normal/0014-kevin-install.hook.chroot');
 assert.match(iso,/worker-input-kevin-ci1/);
 assert.doesNotMatch(iso,/run-id: 42929287076/);
 for(const hash of ['c28046a7573efedc8806e8ea70c60be8df3c4ff52101aa6264f929b4fc046f1d','9d00e6cd1b2917c63022664426c8f25e174644711882c1671894a60bb5e4d0d9','e75fe8dba441f1543d618bd541e61eef660b788584f677a8189b74132b01cefe'])assert.ok(iso.includes(hash));
 assert.match(iso,/kevin-source-candidate inputs/);
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
