import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('default swaylock keeps its prompt and masked typing feedback visible',()=>{
 const config=read('image/config/includes.chroot/etc/swaylock/config');
 for(const option of ['indicator-idle-visible','indicator-caps-lock','show-failed-attempts','ignore-empty-password','scaling=center']) assert.ok(config.split('\n').includes(option),option);
 assert.match(config,/^image=\/usr\/share\/southbag-lock\/prompt.png$/m);
 const png=readFileSync(new URL('../image/config/includes.chroot/usr/share/southbag-lock/prompt.png',import.meta.url));
 assert.equal(png.subarray(1,4).toString(),'PNG');
 assert.equal(png.readUInt32BE(16),640); assert.equal(png.readUInt32BE(20),480);
 assert.ok(read('packaging/build-lockd-deb.sh').includes('usr/share/southbag-lock/prompt.png'));
 assert.match(read('image/config/includes.chroot/usr/local/bin/southbag-lock'),/exec \$\{SOUTHBAG_LOCK_SURFACE:-swaylock\}/);
});
test('recovery never opens the signed-in device cookie jar',()=>{
 const manager=read('image/config/includes.chroot/usr/local/bin/southbag-device-session');
 const line=manager.split('\n').find(l=>l.includes('--gapplication-app-id=cc.southbag.recovery'));
 assert.ok(line);assert.ok(!line.includes('--cookie-jar'));
});
