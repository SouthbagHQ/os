import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const session=join(here,'..','image/config/includes.chroot/usr/local/bin/southbag-session');
function setup(){
 const base=mkdtempSync(join(tmpdir(),'compositor-'));const bin=join(base,'bin');mkdirSync(bin);
 const log=join(base,'calls'),state=join(base,'state'),cg=join(base,'cg');mkdirSync(join(cg,'services'),{recursive:true});
 writeFileSync(join(cg,'services/cgroup.events'),'populated 0\n');
 function script(name,body){const p=join(bin,name);writeFileSync(p,'#!/bin/sh\n'+body+'\n',{mode:0o755});return p;}
 const ctl=script('systemctl',`echo "ctl $*" >>"${log}"
case "$2" in
 list-units) echo 'southbag-compositor-services.scope loaded inactive dead services' ;;
 show) echo /services ;;
 is-active) exit 3 ;;
 stop) exit 0 ;;
 *) exit 2 ;;
esac`);
 const mgr=script('manager',`echo "manager $*" >>"${log}"
[ ! -e "${base}/fail" ] || exit 1
rm -f "${state}/device-session/compositor-stale"`);
 const compositor=script('compositor',`echo "compositor $*" >>"${log}"
[ ! -e "${state}/device-session/compositor-stale" ]`);
 return {base,log,state,cg,run:()=>spawnSync('sh',[session],{env:{...process.env,HOME:base,SOUTHBAG_STATE_DIR:state,SOUTHBAG_SESSION_SYSTEMCTL:ctl,SOUTHBAG_SESSION_MANAGER:mgr,SOUTHBAG_SESSION_COMPOSITOR:compositor,SOUTHBAG_DEVICE_CGROUP_ROOT:cg,SOUTHBAG_SESSION_DEADLINE:'2'},encoding:'utf8',timeout:10000})};
}
test('session preflight and exit both clean up; configured compositor and service scope are selected',()=>{
 const f=setup();try{
  const r=f.run();assert.equal(r.status,0,r.stderr);const log=readFileSync(f.log,'utf8');
  assert.equal((log.match(/manager quiesce/g)||[]).length,2);
  assert.ok(log.indexOf('manager quiesce')<log.indexOf('compositor '));
  assert.match(log,/compositor -C \/etc\/labwc -s systemd-run --user --scope --collect --unit=southbag-compositor-services --property=KillMode=control-group/);
 }finally{rmSync(f.base,{recursive:true,force:true})}
});
test('failed cleanup refuses a new compositor and retains stale gate',()=>{
 const f=setup();try{writeFileSync(join(f.base,'fail'),'');const r=f.run();assert.notEqual(r.status,0);assert.doesNotMatch(readFileSync(f.log,'utf8'),/compositor /);assert.equal(existsSync(join(f.state,'device-session/compositor-stale')),true);
 }finally{rmSync(f.base,{recursive:true,force:true})}
});
test('populated old service cgroup refuses startup before manager or compositor',()=>{
 const f=setup();try{writeFileSync(join(f.cg,'services/cgroup.events'),'populated 1\n');assert.notEqual(f.run().status,0);assert.doesNotMatch(readFileSync(f.log,'utf8'),/manager |compositor /);
 }finally{rmSync(f.base,{recursive:true,force:true})}
});
