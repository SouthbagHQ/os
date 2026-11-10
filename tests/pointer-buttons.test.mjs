import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const patch=readFileSync(new URL('../image/config/includes.chroot/opt/cog-pointer-buttons.patch',import.meta.url),'utf8');
const hook=readFileSync(new URL('../image/config/hooks/normal/0022-cog-dialog-build.hook.chroot',import.meta.url),'utf8');

test('compiled pointer mapping preserves press/release identity for Linux buttons',()=>{
 const added=patch.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1));
 assert.ok(added.includes('#include <linux/input-event-codes.h>'));
 // Execute the normalization block as shipped by the backport. This catches
 // regressions that map only presses, clear releases, or use the Linux code.
 const block=patch.split('\n').filter(l=>l.startsWith(' ')||l.startsWith('+')).filter(l=>!l.startsWith('+++')).map(l=>l.slice(1)).join('\n');
 const start=block.indexOf('    if (button >= BTN_MOUSE)');
 const end=block.indexOf('    wl_data.pointer.state = state;',start);
 assert.ok(start>=0&&end>start);
 const body=block.slice(start,end)+'    wl_data.pointer.state = state;';
 const dir=mkdtempSync(join(tmpdir(),'pointer-map-'));
 try {
  const source=`#include <linux/input-event-codes.h>\n#include <assert.h>\nstruct { struct { unsigned button,state; } pointer; } wl_data;\nstatic void mapped(unsigned button,unsigned state){\n${body}\n}\nint main(void){for(unsigned b=BTN_MOUSE;b<BTN_MOUSE+8;b++){for(unsigned state=0;state<2;state++){mapped(b,state);assert(wl_data.pointer.button==b-BTN_MOUSE+1);assert(wl_data.pointer.state==state);}}mapped(0,0);assert(wl_data.pointer.button==0);return 0;}\n`;
  writeFileSync(join(dir,'map.c'),source);
  const built=spawnSync('cc',['-Wall','-Wextra','-Werror',join(dir,'map.c'),'-o',join(dir,'map')],{encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  assert.equal(spawnSync(join(dir,'map')).status,0);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('image applies pointer backport after existing patches and cleans its source',()=>{
 const dialog=hook.indexOf('patch -p1 < /opt/cog-dialog.patch');
 const shutdown=hook.indexOf('patch -p1 < /opt/cog-shutdown-ordering.patch');
 const pointer=hook.indexOf('patch -p1 < /opt/cog-pointer-buttons.patch');
 const build=hook.indexOf('ninja -C build');
 assert.ok(dialog>=0&&shutdown>dialog&&pointer>shutdown&&build>pointer);
 assert.match(hook,/rm -rf[^\n]*\/opt\/cog-pointer-buttons\.patch/);
 assert.match(hook,/apt-get purge -y \$added/);
});
