// Run a root-owned-policy fixture without changing production policy paths.
// Ubuntu's AppArmor can deny uid_map even when unshare itself is installed.
import {spawnSync} from 'node:child_process';
import {statSync} from 'node:fs';
const userns=spawnSync('unshare',['--user','--map-root-user','true'],{encoding:'utf8'}).status===0;
export function fixtureRoot(policy,args,env){
 if(userns)return spawnSync('unshare',['--user','--map-root-user','sh',...args],{env,encoding:'utf8',timeout:10000});
 // Hosted CI has passwordless sudo. Own only this caller-created fixture.
 try{statSync(policy);const ch=spawnSync('sudo',['-n','chown','--no-dereference','0:0',policy],{encoding:'utf8'});if(ch.status!==0)return ch;}catch{}
 const allowed=Object.entries(env).filter(([k])=>k.startsWith('SOUTHBAG_')||['SURFACE_LOG','CLIENT_LOG','STOP_RESULT'].includes(k)).map(([k,v])=>`${k}=${v}`);
 return spawnSync('sudo',['-n','env',...allowed,'sh',...args],{encoding:'utf8',timeout:10000});
}
