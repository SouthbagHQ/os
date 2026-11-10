import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Parse the shipped XML rather than accepting matching words in comments.
// labwc 0.8.3 accepts query conditions and Execute arguments as attributes.
const path=new URL('../image/config/includes.chroot/etc/labwc/rc.xml',import.meta.url).pathname;
const parsed=spawnSync('python3',['-c',`
import sys,json,xml.etree.ElementTree as E
root=E.parse(sys.argv[1]).getroot()
def obj(e): return dict(tag=e.tag,attrs=e.attrib,children=[obj(c) for c in e])
print(json.dumps(obj(root)))
`,path],{encoding:'utf8'});
assert.equal(parsed.status,0,parsed.stderr);
const root=JSON.parse(parsed.stdout);
const keyboard=root.children.find(x=>x.tag==='keyboard');
const bindings=Object.fromEntries(keyboard.children.filter(x=>x.tag==='keybind').map(x=>[x.attrs.key,x.children]));
const desktop=readFileSync(new URL('../src/Desktop.svelte',import.meta.url),'utf8');

test('Alt-F4 closes service windows, never the desktop shell',()=>{
 const [action]=bindings['A-F4'];
 assert.equal(action.attrs.name,'If');
 const query=action.children.find(x=>x.tag==='query');
 assert.deepEqual(query.attrs,{identifier:'cc.southbag.shell'});
 assert.deepEqual(action.children.find(x=>x.tag==='then').children,[]);
 const otherwise=action.children.find(x=>x.tag==='else').children;
 assert.equal(otherwise.length,1);
 assert.deepEqual(otherwise[0].attrs,{name:'Close'});
});

test('both directions of native window switching are available',()=>{
 assert.deepEqual(bindings['A-Tab'][0].attrs,{name:'NextWindow'});
 assert.deepEqual(bindings['A-S-Tab'][0].attrs,{name:'PreviousWindow'});
});

test('lock shortcut belongs to the compositor, not the focused page',()=>{
 assert.deepEqual(bindings['C-A-l'][0].attrs,{name:'Execute',command:'/usr/local/bin/southbag-lock'});
 assert.doesNotMatch(desktop,/event\.ctrlKey|event\.altKey|onkeydown=\{onKeydown\}/);
 // The launcher still has its explicit lock button and error reporting.
 assert.match(desktop,/onlock=/);
 assert.match(desktop,/fetch\("\/cgi-bin\/lock", \{ method: "POST" \}\)/);
});

test('no terminal or compositor-exit default is enabled',()=>{
 assert.equal(bindings.default,undefined);
 const actions=keyboard.children.flatMap(x=>x.children);
 assert.ok(!actions.some(x=>['Exit','Reconfigure','Debug'].includes(x.attrs.name)));
 assert.ok(!actions.some(x=>/terminal|xterm|foot|bash|\/bin\/sh/.test(x.attrs.command??'')));
});
