// Fixture-only integration tests for the nav-state milestones in the patched
// CGIs and manager. Mock identity server, fixture systemd shims; no network,
// no browser, no VM. Pattern follows tests/account.test.mjs + device-session.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NAVBIN = join(here, "..", "image", "config", "includes.chroot", "usr", "local", "bin", "southbag-nav-state");
// Do not depend on the git checkout's exec bit: web flows land files as
// 644 (build.sh restores the bit for the image; cf. lock-inhibit.test.mjs).
chmodSync(NAVBIN, 0o755);
const ACCOUNT = join(here, "..", "image", "shell-extra", "cgi-bin", "account");
const MANAGER = join(here, "..", "image", "config", "includes.chroot", "usr", "local", "bin", "southbag-device-session");
const FIXBIN_SRC = join(here, "fixtures", "bin");
// Fixture shims land 644 in web-published checkouts and the manager execs
// them directly, so provision executable copies per run (same pattern as
// device-session.test.mjs) instead of trusting tree modes.
const FIXBIN = mkdtempSync(join(tmpdir(), "navstate-shim-"));
for (const f of ["systemd-run", "systemctl"]) {
  const dst = join(FIXBIN, f);
  writeFileSync(dst, readFileSync(join(FIXBIN_SRC, f)));
  chmodSync(dst, 0o755);
}
const TOKEN = "valid.token_abc-123~456";
const SUB = "user-1";
const EMAIL = "inw@mail.instinct.com";

let server, origin, base, stateDir, root;

async function startMock() {
  const code = `
const { createServer } = require("node:http");
const server = createServer((req, res) => {
  if (req.url === "/api/account/status" && req.headers.authorization === "Bearer ${TOKEN}") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sub: ${JSON.stringify(SUB)}, email: ${JSON.stringify(EMAIL)}, frozen: false }));
    return;
  }
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "invalid" }));
});
server.listen(0, "127.0.0.1", () => console.log("PORT " + server.address().port));
`;
  server = spawn("node", ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve) => {
    server.stdout.once("data", (d) => resolve(`http://127.0.0.1:${String(d).trim().split(" ")[1]}`));
  });
}

before(async () => {
  origin = await startMock();
  base = mkdtempSync(join(tmpdir(), "navstate-int-"));
  stateDir = join(base, "state");
  root = join(stateDir, "device-session");
  mkdirSync(root, { recursive: true });
});
after(() => { server.kill(); rmSync(base, { recursive: true, force: true }); });

const navPath = () => join(stateDir, "nav-state");
const readNav = () => (existsSync(navPath()) ? readFileSync(navPath(), "utf8") : null);
const clearNav = () => rmSync(navPath(), { force: true });
function writeGen(g) { writeFileSync(join(root, "generation"), `${g}\n`); }

function accountCgi({ method = "POST", originHeader = "http://127.0.0.1:8080", body }) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const env = {
    PATH: process.env.PATH,
    REQUEST_METHOD: method,
    CONTENT_LENGTH: String(Buffer.byteLength(payload)),
    CONTENT_TYPE: "application/json",
    HTTP_ORIGIN: originHeader,
    SOUTHBAG_IDENTITY_ORIGIN: origin,
    SOUTHBAG_STATE_DIR: stateDir,
    SOUTHBAG_WGET: "wget",
    SOUTHBAG_NAV_STATE_BIN: NAVBIN,
    HOME: base,
  };
  const r = spawnSync("sh", [ACCOUNT], { input: payload, env });
  return { status: r.status, out: r.stdout.toString() };
}

test("account success writes account_bound, mode 600", () => {
  clearNav(); writeGen("gen-a");
  // The account CGI's consistency fence requires expectedSubject; a body
  // without it is refused 400 "missing expected subject" with exit 0 and
  // nothing on stderr, which is why the earlier fixture failed silently.
  const r = accountCgi({ body: { accessToken: TOKEN, generation: "gen-a", expectedSubject: SUB } });
  assert.match(r.out, /recorded":true/);
  assert.equal(readNav(), "account_bound\n");
});

test("identity refusal writes binding_failed (overwrites earlier milestone)", () => {
  clearNav(); writeGen("gen-a");
  const r = accountCgi({ body: { accessToken: "wrong.token_abc-123~456", generation: "gen-a" } });
  assert.match(r.out, /Status: 502/);
  assert.equal(readNav(), "binding_failed\n");
});

test("identity refusal from a retired era writes no milestone (fenced)", () => {
  clearNav(); writeGen("gen-b");
  const r = accountCgi({ body: { accessToken: "wrong.token_abc-123~456", generation: "gen-a" } });
  assert.match(r.out, /Status: 502/);
  assert.equal(readNav(), null, "retired-era refusal must not clobber journey state");
});

test("lock contention skips the milestone but never the response", async () => {
  // A reset/launch holding the session lock is exactly the case to skip the
  // write; the 502 auth response must be identical either way.
  clearNav(); writeGen("gen-a");
  const holder = spawn("flock", ["-x", join(stateDir, "session.lock"), "-c", "sleep 5"]);
  await new Promise((r) => setTimeout(r, 300));
  const r = accountCgi({ body: { accessToken: "wrong.token_abc-123~456", generation: "gen-a" } });
  assert.match(r.out, /Status: 502/);
  assert.equal(readNav(), null, "contended lock: milestone skipped, not queued");
  holder.kill();
  await new Promise((res) => holder.on("exit", res));
});

test("clear writes account_cleared", () => {
  clearNav(); writeGen("gen-a");
  const r = accountCgi({ body: { clear: true, generation: "gen-a" } });
  assert.match(r.out, /recorded":false/);
  assert.equal(readNav(), "account_cleared\n");
});

test("negative: wrong origin / retired era / bad token shape write no milestone", () => {
  clearNav(); writeGen("gen-a");
  accountCgi({ originHeader: "https://evil.example", body: { accessToken: TOKEN, generation: "gen-a" } });
  assert.equal(readNav(), null, "foreign origin");
  accountCgi({ body: { accessToken: TOKEN, generation: "old-era" } });
  assert.equal(readNav(), null, "retired era");
  accountCgi({ body: { accessToken: "short", generation: "gen-a" } });
  assert.equal(readNav(), null, "bad token shape");
});

test("identity-auth ships unchanged: no era identity, no milestone", () => {
  // The token-exchange milestone was dropped: identity-auth carries no era
  // identity, so the word could not be era-bound without changing the
  // page/proxy contract. The pack must not patch it at all.
  const idauth = readFileSync(join(here, "..", "image", "shell-extra", "cgi-bin", "identity-auth"), "utf8");
  assert.equal(idauth.includes("southbag-nav-state"), false, "identity-auth must carry no milestone");
});

test("manager reset clears nav-state with the account note", () => {
  // Teardown: a dead era's success milestone must not outlive the reset.
  const b = mkdtempSync(join(tmpdir(), "navstate-reset-"));
  const st = join(b, "state"), rt = join(st, "device-session");
  mkdirSync(rt, { recursive: true });
  mkdirSync(join(b, "systemd"), { recursive: true });
  mkdirSync(join(b, "cgroup"), { recursive: true });
  writeFileSync(join(rt, "generation"), "gen-a\n");
  writeFileSync(join(st, "account"), "user-1\tinw@mail.instinct.com\n", { mode: 0o600 });
  writeFileSync(join(st, "nav-state"), "account_bound\n", { mode: 0o600 });
  const env = {
    ...process.env,
    SOUTHBAG_STATE_DIR: st,
    SOUTHBAG_ACCOUNT_STATUS_BIN:"/bin/true",
   SOUTHBAG_DEVICE_SYSTEMD_RUN: join(FIXBIN, "systemd-run"),
    SOUTHBAG_DEVICE_SYSTEMCTL: join(FIXBIN, "systemctl"),
    SOUTHBAG_DEVICE_CGROUP_ROOT: join(b, "cgroup"),
    SOUTHBAG_DEVICE_START_DEADLINE: "3",
    SOUTHBAG_DEVICE_STOP_DEADLINE: "3",
    FAKE_SYSTEMD_STATE: join(b, "systemd"),
    HOME: b,
  };
  const r = spawnSync("sh", [MANAGER, "reset", "gen-a"], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(st, "nav-state")), false, "reset must clear the era's milestone");
  assert.equal(existsSync(join(st, "account")), false, "reset still removes the account note");
  assert.equal(existsSync(join(rt, "generation")), false, "reset still removes the generation");
  rmSync(b, { recursive: true, force: true });
});

test("manager new era clears a stale nav-state before shell start", () => {
  // Era rotation: no generation file + leftover nav-state from a prior era.
  const b = mkdtempSync(join(tmpdir(), "navstate-era-"));
  const st = join(b, "state"), rt = join(st, "device-session");
  mkdirSync(rt, { recursive: true });
  mkdirSync(join(b, "systemd"), { recursive: true });
  mkdirSync(join(b, "cgroup"), { recursive: true });
  writeFileSync(join(st, "nav-state"), "account_bound\n");
  const env = {
    ...process.env,
    SOUTHBAG_STATE_DIR: st,
    SOUTHBAG_ACCOUNT_STATUS_BIN:"/bin/true",
   SOUTHBAG_DEVICE_SYSTEMD_RUN: join(FIXBIN, "systemd-run"),
    SOUTHBAG_DEVICE_SYSTEMCTL: join(FIXBIN, "systemctl"),
    SOUTHBAG_DEVICE_CGROUP_ROOT: join(b, "cgroup"),
    SOUTHBAG_DEVICE_START_DEADLINE: "3",
    SOUTHBAG_DEVICE_STOP_DEADLINE: "3",
    FAKE_SYSTEMD_STATE: join(b, "systemd"),
    HOME: b,
  };
  const r = spawnSync("sh", [MANAGER, "shell"], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(st, "nav-state")), false, "stale milestone must be cleared at era start");
  assert.equal(existsSync(join(rt, "generation")), true, "new generation published");
  rmSync(b, { recursive: true, force: true });
});
