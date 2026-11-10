import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/palantir.js',import.meta.url),'utf8');
function run(user={}){
 let config,key;const calls=[];
 const posthog={__loaded:true,init:(k,c)=>{key=k;config=c;},capture:(...v)=>calls.push(['capture',...v]),identify:(...v)=>calls.push(['identify',...v]),reset:()=>calls.push(['reset']),register:(...v)=>calls.push(['register',...v]),get_property:()=>null};
 const context={window:{posthog},document:{currentScript:{dataset:{app:'os',...user}}},location:{hostname:'127.0.0.1'},fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({authenticated:false})}),Promise};
 vm.runInNewContext(source,context);config.loaded(posthog);return {config,key,calls};
}
test('same always-on Southbag project, transport, collection and app identity',()=>{
 const {config,key,calls}=run({userId:'synthetic-account',userEmail:'fixture@example.invalid',userName:'Fixture'});
 assert.equal(key,'phc_rStyYsw4wrB8MwXEsPBJjz57uipHycNVwFPaw2m3aYXo');
 assert.equal(config.api_host,'https://palantir.southbag.cc');
 assert.equal(config.autocapture,true);assert.equal(config.disable_session_recording,false);
 assert.equal(config.session_recording.maskAllInputs,false);
 assert.ok(calls.some(c=>c[0]==='register'&&c[1].southbag_app==='os'));
 assert.ok(calls.some(c=>c[0]==='identify'&&c[1]==='synthetic-account'));
});
test('shipping entry initializes collector and has no analytics-off build flag',()=>{
 const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 const wrapper=readFileSync(new URL('../src/platform/palantir.ts',import.meta.url),'utf8');
 assert.match(main,/startAnalytics\(session\?\.customer \?\? null\)/);
 assert.match(wrapper,/dataset\.app='os'/);assert.doesNotMatch(wrapper,/opt_out|DISABLE|enabled\s*:/);
});

import {mkdtempSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const helper=new URL('../image/config/includes.chroot/usr/local/bin/southbag-analytics',import.meta.url).pathname;
test('server outcomes use verified binding and replay id, never token/cookie/body',()=>{
 const dir=mkdtempSync(join(tmpdir(),'os-analytics-'));try{
  mkdirSync(join(dir,'state'));writeFileSync(join(dir,'state/account'),'verified-subject\tfixture@example.invalid\n');
  writeFileSync(join(dir,'wget'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n',{mode:0o700});
  const cookie=encodeURIComponent(JSON.stringify({distinct_id:'anonymous', $sesid:[1,'replay-fixture',2],other:'NEVER-FORWARD'}));
  const env={...process.env,SOUTHBAG_STATE_DIR:join(dir,'state'),SOUTHBAG_ANALYTICS_WGET:join(dir,'wget'),CAPTURE:join(dir,'capture'),HTTP_COOKIE:'ph_phc_rStyYsw4wrB8MwXEsPBJjz57uipHycNVwFPaw2m3aYXo_posthog='+cookie,HTTP_AUTHORIZATION:'Bearer NEVER-FORWARD'};
  assert.equal(spawnSync('sh',[helper,'account_bound'],{env,input:'NEVER-FORWARD'}).status,0);
  const result=readFileSync(join(dir,'capture'),'utf8');
  assert.match(result,/verified-subject/);assert.match(result,/replay-fixture/);assert.match(result,/palantir-server/);assert.doesNotMatch(result,/NEVER-FORWARD|fixture@example.invalid/);
  rmSync(join(dir,'capture'));assert.notEqual(spawnSync('sh',[helper,'arbitrary-event'],{env}).status,0);assert.equal(existsSync(join(dir,'capture')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('image builder preserves executable server collector after web publication',()=>{
 const builder=readFileSync(new URL('../image/build.sh',import.meta.url),'utf8');
 assert.match(builder,/chmod \+x.*southbag-analytics/);
});
