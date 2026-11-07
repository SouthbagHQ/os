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
// Records requests in order: parsed JSON bodies, or 'genfetch' for the
// bodyless generation POST. generations rotates what the CGI hands out.
function recorder(answer, generations = ['g1']) {
  const requests = [];
  let genCalls = 0;
  const fetcher = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.includes('device-session?generation') && !body) {
      requests.push('genfetch');
      const g = generations[Math.min(genCalls++, generations.length - 1)];
      return { ok: true, json: async () => ({ generation: g }) };
    }
    requests.push(body);
    return answer(url, body, requests.length);
  };
  return { requests, fetcher };
}
const okAll = () => ({ ok: true, json: async () => ({}) });
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

test('login captures the era, the binding carries it, logout names it and never refetches', async () => {
  const { requests, fetcher } = recorder(okAll);
  const { mod, local } = await load(fetcher);
  mod.storeSession(fixture);
  await mod.logout();
  assert.deepEqual(requests, [
    'genfetch',                                       // era captured at login, once
    { accessToken: 'test', generation: 'g1', expectedSubject: 'test' },        // binding write carries the era
    { clear: true, generation: 'g1' },                // clear names the same era
    { generation: 'g1' },                             // reset names the login-time era
  ]);
  assert.equal(local.size, 0);
});

test('logout waits for pending binding and cleanup before forgetting session', async () => {
  let release; const { requests, fetcher } = recorder((url, body, n) => {
    if (n === 2) return new Promise(resolve => { release = () => resolve(okAll()); }); // hold the binding write
    return okAll();
  });
  const { mod, local } = await load(fetcher);
  mod.storeSession(fixture);
  let done = false;
  const out = mod.logout().then(() => { done=true; });
  await flush();
  assert.equal(done, false); assert.equal(requests.length, 2); assert.equal(local.size, 0);
  release(); await out;
  assert.deepEqual(requests, ['genfetch', { accessToken: 'test', generation: 'g1', expectedSubject: 'test' }, { clear: true, generation: 'g1' }, { generation: 'g1' }]);
  assert.equal(local.size, 0);
});

test('cleanup failure retains desktop session for retry', async () => {
  const { fetcher } = recorder((url, body) => ({ ok: !body?.clear, json: async () => ({}) }));
  const { mod, local } = await load(fetcher);
  mod.storeSession(fixture);
  await assert.rejects(mod.logout(), /cleanup failed/); assert.equal(local.size, 2); // session + generation
  const second = recorder(okAll);
  globalThis.fetch = second.fetcher;
  await mod.logout();
  assert.deepEqual(second.requests, [{ clear: true, generation: 'g1' }, { generation: 'g1' }]);
  assert.equal(local.size, 0);
});

test('reset refusal: binding already cleared, local session retained for retry (actual partial state)', async () => {
  // The bounded reset answers 503 (blocked). The honest resulting state is
  // NOT an untouched session: the account binding was cleared first, apps
  // may already be stopped manager-side, and only the local UI session and
  // its login-time era survive for the retry.
  const { requests, fetcher } = recorder((url, body) =>
    url.includes('device-session?reset') ? { ok: false, json: async () => ({}) } : okAll());
  const { mod, local } = await load(fetcher);
  mod.storeSession(fixture);
  await assert.rejects(mod.logout(), /cleanup failed/);
  assert.deepEqual(requests, [
    'genfetch', { accessToken: 'test', generation: 'g1', expectedSubject: 'test' }, { clear: true, generation: 'g1' }, { generation: 'g1' },
  ]);
  assert.equal(local.size, 2); // session + era retained; binding already gone server-side
  const second = recorder(okAll);
  globalThis.fetch = second.fetcher;
  await mod.logout(); // retry re-clears (idempotent) and resets with the same login era
  assert.deepEqual(second.requests, [{ clear: true, generation: 'g1' }, { generation: 'g1' }]);
  assert.equal(local.size, 0);
});

test('re-login during logout is refused before any new generation or binding request', async () => {
  let releaseClear;
  const { requests, fetcher } = recorder((url, body) => {
    if (body?.clear) return new Promise(resolve => { releaseClear = () => resolve(okAll()); });
    return okAll();
  });
  const { mod, local } = await load(fetcher);
  await mod.storeSession(fixture);
  const out = mod.logout();
  await flush();
  await assert.rejects(mod.storeSession({ ...fixture, accessToken: 'tok2' }), /sign-out is in progress/);
  releaseClear(); await out;
  assert.deepEqual(requests, [
    'genfetch', { accessToken: 'test', generation: 'g1', expectedSubject: 'test' },
    { clear: true, generation: 'g1' }, { generation: 'g1' },
  ]);
  assert.equal(local.size, 0);
});

test('missing era binding fails closed before any write', async () => {
  const { requests, fetcher } = recorder(okAll);
  const { mod, local } = await load(fetcher);
  local.set('southbag.session', JSON.stringify(fixture)); // hand-stored, no generation
  await assert.rejects(mod.logout(), /generation is unknown/);
  assert.deepEqual(requests, []); // no clear, no reset: nothing is touched
  assert.equal(local.size, 1); // session retained
});

for (const status of [409, 502]) {
  test(`binding refusal ${status} cannot leave a newly stored session or era`, async () => {
    const { requests, fetcher } = recorder(() => ({ ok: false, status }));
    const { mod, local } = await load(fetcher);
    await assert.rejects(mod.storeSession(fixture), /Account binding failed/);
    assert.equal(local.size, 0);
    assert.deepEqual(requests, ['genfetch', { accessToken: 'test', generation: 'g1', expectedSubject: 'test' }]);
  });
}
test('unavailable generation cannot store a session or call account', async () => {
  let count = 0;
  const { mod, local } = await load(async () => { count++; return { ok: false }; });
  await assert.rejects(mod.storeSession(fixture), /state unavailable/);
  assert.equal(local.size, 0); assert.equal(count, 1);
});
for (const cleanupOK of [true, false]) {
  test(`storage failure after binding removes local partial state, cleanup=${cleanupOK}`, async () => {
    const { requests, fetcher } = recorder((url, body) => ({ ok: !body?.clear || cleanupOK }));
    const { mod, local } = await load(fetcher);
    const set = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (k,v) => {
      if(k === 'southbag.session') throw new Error('fixture quota');
      return set(k,v);
    };
    await assert.rejects(mod.storeSession(fixture), cleanupOK ? /Sign-in was not saved/ : /recovery is needed/);
    assert.equal(local.size, 0);
    assert.deepEqual(requests, ['genfetch', { accessToken: 'test', generation: 'g1', expectedSubject: 'test' }, { clear: true, generation: 'g1' }]);
  });
}

test('failed storage and unavailable cleanup reports recovery, without hiding the cleanup error', async () => {
  const { requests, fetcher } = recorder((url, body) => { if(body?.clear) throw new Error('fixture offline'); return okAll(); });
  const { mod, local } = await load(fetcher);
  globalThis.localStorage.setItem = () => { throw new Error('fixture storage denied'); };
  await assert.rejects(mod.storeSession(fixture), /recovery is needed/);
  assert.equal(local.size, 0);
  assert.equal(requests.at(-1).clear, true);
});
