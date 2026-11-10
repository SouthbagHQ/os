import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const cgi=join(here,'..','image','shell-extra','cgi-bin','volume');

// Mock-contract test: the real CGI, a recording amixer shim, and the CGI
// environment busybox httpd would set. The shim exits 0, or 1 when its
// control file says the mixer is gone.
function setup(){
 const base=mkdtempSync(join(tmpdir(),'volume-'));
 const bin=join(base,'bin'); mkdirSync(bin);
 const log=join(base,'amixer.args');
 const shim=['#!/bin/sh','echo "$@" >>"'+log+'"','if [ -e "'+base+'/mixer-down" ]; then exit 1; fi','exit 0',''].join('\n');
 writeFileSync(join(bin,'amixer'),shim);
 chmodSync(join(bin,'amixer'),0o755);
 return {base,log,amixer:join(bin,'amixer')};
}
function run(env){
 const r=spawnSync('sh',[cgi],{env:{PATH:'/usr/bin:/bin',...env},encoding:'utf8'});
 assert.equal(r.status,0,'CGI must answer, not crash: '+r.stderr);
 return r.stdout;
}

test('volume keys adjust the mixer with fixed steps',()=>{
 const {log,amixer}=setup();
 for(const [q,want] of [['up','-q set Master 5%+'],['down','-q set Master 5%-'],['mute','-q set Master toggle']]){
  const out=run({REQUEST_METHOD:'POST',HTTP_ORIGIN:'http://127.0.0.1:8080',QUERY_STRING:q,SOUTHBAG_AMIXER:amixer});
  assert.match(out,/Status: 204/);
  assert.equal(readFileSync(log,'utf8').trim().split('\n').at(-1),want);
 }
});

test('GET changes nothing and hears 405',()=>{
 const {log,amixer}=setup();
 const out=run({REQUEST_METHOD:'GET',HTTP_ORIGIN:'http://127.0.0.1:8080',QUERY_STRING:'up',SOUTHBAG_AMIXER:amixer});
 assert.match(out,/Status: 405/);
 assert.throws(()=>readFileSync(log,'utf8'));
});

test('other origins cannot move the volume',()=>{
 const {log,amixer}=setup();
 for(const origin of ['https://banking.southbag.cc','http://127.0.0.1:8080.evil.test','']){
  const out=run({REQUEST_METHOD:'POST',HTTP_ORIGIN:origin,QUERY_STRING:'down',SOUTHBAG_AMIXER:amixer});
  assert.match(out,/Status: 403/);
 }
 assert.throws(()=>readFileSync(log,'utf8'));
});

test('caller words never become mixer arguments',()=>{
 const {log,amixer}=setup();
 for(const q of ['','UP','up;rm','set%20Master%200%25','up&down','mute ']){
  const out=run({REQUEST_METHOD:'POST',HTTP_ORIGIN:'http://127.0.0.1:8080',QUERY_STRING:q,SOUTHBAG_AMIXER:amixer});
  assert.match(out,/Status: 400/,'query: '+q);
 }
 assert.throws(()=>readFileSync(log,'utf8'));
});

test('a refused mixer fails closed as 500',()=>{
 const {base,log,amixer}=setup();
 writeFileSync(join(base,'mixer-down'),'');
 const out=run({REQUEST_METHOD:'POST',HTTP_ORIGIN:'http://127.0.0.1:8080',QUERY_STRING:'up',SOUTHBAG_AMIXER:amixer});
 assert.match(out,/Status: 500/);
});
