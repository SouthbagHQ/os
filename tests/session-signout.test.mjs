import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/platform/identity.ts', import.meta.url), 'utf8').replace('import.meta.env.MODE', '"device"');
let seq = 0;
async function load(fetcher) {
  globalThis.fetch = fetcher;
  const local = new Map(); const session = new Map();
  globalThis.localStorage = { setItem: (k,v) => local.set(k,v), getItem: k => local.get(k), removeItem: k => local.delete(k) };
  globalThis.sessionStorage = { removeItem: k => session.delete(k) };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js + `\n//${seq++}`).toString('base64')}`);
  return { mod, local };
}
const fixture = { customer: { sub: 'test' }, expiresAt: Date.now()+60000, accessToken: 'test' };
test('logout waits for pending binding and cleanup before forgetting session', async () => {
  let release; const requests = [];
  const { mod, local } = await load(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) await new Promise(resolve => { release=resolve; });
    return { ok: true };
  });
  mod.storeSession(fixture);
  let done = false;
  const out = mod.logout().then(() => { done=true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(done, false); assert.equal(requests.length, 1); assert.equal(local.size, 1);
  release(); await out;
  assert.deepEqual(requests, [{ accessToken: 'test' }, { clear: true }]); assert.equal(local.size, 0);
});
test('cleanup failure retains desktop session for retry', async () => {
  const { mod, local } = await load(async (_url, options) => ({ ok: !JSON.parse(options.body).clear }));
  mod.storeSession(fixture);
  await assert.rejects(mod.logout(), /cleanup failed/); assert.equal(local.size, 1);
  globalThis.fetch = async () => ({ ok: true });
  await mod.logout(); assert.equal(local.size, 0);
});
