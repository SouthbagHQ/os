import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,chmodSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../image/config/includes.chroot/usr/local/bin/southbag-lock',import.meta.url),'utf8');
test('all-fields root policy presents lock without credential-only inhibition; unsafe policies deny',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kevin-lock-policy-'));
 try {
  const state=join(dir,'state');mkdirSync(state);writeFileSync(join(state,'account'),'fixture\n');
  const policy=join(dir,'policy'),script=join(dir,'lock'),surface=join(dir,'surface'),log=join(dir,'surface.log');
  writeFileSync(script,source.replace('policy=/etc/southbag/kevin-all-fields','policy='+policy));
  writeFileSync(surface,'#!/bin/sh\necho invoked >> "$SURFACE_LOG"\n');chmodSync(surface,0o755);
  const env={...process.env,SOUTHBAG_STATE_DIR:state,SOUTHBAG_LOCK_BROKER:join(dir,'missing-broker'),SOUTHBAG_LOCK_SURFACE:surface,SURFACE_LOG:log};
  // User namespace maps this fixture's owner to root, without host root access.
  const call=()=>spawnSync('unshare',['--user','--map-root-user','sh',script],{env,encoding:'utf8',timeout:10000});
  writeFileSync(policy,'kevin=all-fields\n');chmodSync(policy,0o644);
  let r=call();assert.equal(r.status,0,r.stderr);assert.ok(existsSync(log));
  for(const kind of ['missing','writable','symlink','wrong-content']) {
   rmSync(log,{force:true});rmSync(join(state,'locked'),{force:true});rmSync(policy,{force:true});
   if(kind==='symlink'){writeFileSync(join(dir,'target'),'kevin=all-fields\n');symlinkSync(join(dir,'target'),policy);}
   else if(kind!=='missing'){writeFileSync(policy,kind==='wrong-content'?'other-policy\n':'kevin=all-fields\n');chmodSync(policy,kind==='writable'?0o666:0o644);}
   r=call();assert.equal(r.status,1,kind+': '+r.stderr);assert.ok(!existsSync(log),kind);assert.ok(!existsSync(join(state,'locked')),kind);
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});
