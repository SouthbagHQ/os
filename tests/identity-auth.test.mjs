import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'os-proxy-'));
const capture = join(dir, 'args');
writeFileSync(join(dir, 'busybox'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\nprintf \'{"ok":true}\'\n', { mode: 0o700 });
after(() => rmSync(dir, { recursive: true, force: true }));
function run(overrides = {}) {
  rmSync(capture, { force: true });
  const env = { PATH: `${dir}:${process.env.PATH}`, CAPTURE: capture, QUERY_STRING: 'ep=token', REQUEST_METHOD: 'POST', HTTP_ORIGIN: 'http://127.0.0.1:8080', CONTENT_TYPE: 'application/x-www-form-urlencoded', CONTENT_LENGTH: '11', HTTP_COOKIE: 'secret=never-forward', HTTP_AUTHORIZATION: 'Bearer never-forward', ...overrides };
  const r = spawnSync('sh', [new URL('../image/shell-extra/cgi-bin/identity-auth', import.meta.url).pathname], { env, input: 'code=sample' });
  return r.stdout.toString();
}
test('fixed server-side OAuth origin, content type and URL, no caller credentials', () => {
  assert.match(run(), /"ok":true/);
  const args = readFileSync(capture, 'utf8');
  assert.match(args, /Origin: https:\/\/identity.southbag.cc/);
  assert.match(args, /Content-Type: application\/x-www-form-urlencoded/);
  assert.match(args, /https:\/\/identity.southbag.cc\/api\/auth\/oauth2\/token/);
  assert.doesNotMatch(args, /never-forward|Cookie:|Authorization:/);
});
for (const origin of ['', 'null', 'https://evil.invalid', 'http://127.0.0.1:8080.evil.invalid']) {
  test(`reject unsafe caller origin ${origin}`, () => assert.match(run({ HTTP_ORIGIN: origin }), /Status: 403/));
}
test('no arbitrary URL or endpoint and no unsupported content type', () => {
  assert.match(run({ QUERY_STRING: 'ep=https://evil.invalid' }), /Status: 400/);
  assert.match(run({ CONTENT_TYPE: 'text/plain' }), /Status: 415/);
  assert.match(run({ REQUEST_METHOD: 'DELETE' }), /Status: 405/);
  assert.match(run({ CONTENT_LENGTH: '16384' }), /Status: 400/);
});
test('public JWKS GET requires no Origin, only fixed URL', () => {
  assert.match(run({ QUERY_STRING: 'ep=jwks', REQUEST_METHOD: 'GET', HTTP_ORIGIN: '' }), /"ok":true/);
  assert.match(readFileSync(capture, 'utf8'), /https:\/\/identity.southbag.cc\/api\/auth\/jwks/);
});
