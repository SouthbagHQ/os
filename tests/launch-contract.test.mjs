import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileModule} from 'svelte/compiler';

const hostSource=readFileSync(new URL('../src/wm/cog-host.svelte.ts',import.meta.url),'utf8');
const launch=readFileSync(new URL('../image/shell-extra/cgi-bin/launch',import.meta.url),'utf8');
const readiness=readFileSync(new URL('../image/config/includes.chroot/usr/local/bin/southbag-ready',import.meta.url),'utf8');

test('device window host POSTs to the hardened launch CGI',async()=>{
 const ts=new Bun.Transpiler({loader:'ts'}).transformSync(hostSource);
 const {js}=compileModule(ts,{filename:'host.svelte.js',generate:'server'});
 // Server output removes runes; the class needs no Svelte runtime helpers.
 const CogWindowHost=new Function(js.code.replace(/^import .*;$/mg,'').replace('export class','return class'))();
 const requests=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return {ok:true};};
 try{
  const host=new CogWindowHost();
  host.open('files',{title:'Files',size:{width:760,height:480},min:{width:420,height:280}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/cgi-bin/launch?app=files');
  assert.equal(requests[0].options.method,'POST');
  assert.match(launch,/REQUEST_METHOD:-.*POST/);
  assert.match(launch,/HTTP_ORIGIN:-.*http:\/\/127\.0\.0\.1:8080/);
  assert.equal(host.failed,null);
 }finally{globalThis.fetch=original;}
});

test('readiness ignores service cog windows but notices shell loss or replacement',()=>{
 const base=mkdtempSync(join(tmpdir(),'shell-pids-'));
 try{
  const proc=join(base,'proc');mkdirSync(proc);
  for(const [pid,id] of [[101,'shell'],[202,'files'],[303,'shell'],[404,'shell.fake']]){
   mkdirSync(join(proc,String(pid)));
   writeFileSync(join(proc,String(pid),'cmdline'),`/usr/bin/cog\0--gapplication-app-id=cc.southbag.${id}\0http://example.invalid/\0`);
  }
  const fn=readiness.slice(readiness.indexOf('shell_pids() {'),readiness.indexOf('\nshell_up()')).replaceAll('/proc/',proc+'/');
  function pids(list){
   const script=`busybox() { printf '%s\\n' '${list}'; }\n${fn}\nshell_pids\n`;
   const r=spawnSync('sh',['-c',script],{encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);return r.stdout.trim();
  }
  assert.equal(pids('101'),'101');
  assert.equal(pids('202 101 404'),'101');
  assert.equal(pids('101 202'),'101');
  assert.equal(pids('202 404'),'');
  assert.notEqual(pids('303 202'),pids('101 202'));
 }finally{rmSync(base,{recursive:true,force:true});}
});
