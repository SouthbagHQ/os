// Fixture-only tests for the journey-observability helper and its CGI call
// sites. No network, no browser, no VM: the helper runs as a plain process
// with SOUTHBAG_STATE_DIR pointed at a temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, statSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELPER = new URL("../image/config/includes.chroot/usr/local/bin/southbag-nav-state", import.meta.url).pathname;
// Do not depend on the git checkout's exec bit: web flows land files as
// 644 (build.sh restores the bit for the image; cf. lock-inhibit.test.mjs).
chmodSync(HELPER, 0o755);

const ENUM = ["account_bound", "binding_failed", "account_cleared", "session_reset"];

function run(stateDir, arg) {
  return spawnSync(HELPER, arg === undefined ? [] : [arg], {
    env: { SOUTHBAG_STATE_DIR: stateDir, PATH: "/usr/bin:/bin", HOME: stateDir },
  });
}
function read(stateDir) {
  const p = join(stateDir, "nav-state");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

test("each enum word is recorded verbatim", () => {
  for (const w of ENUM) {
    const d = mkdtempSync(join(tmpdir(), "navstate-"));
    const r = run(d, w);
    assert.equal(r.status, 0);
    assert.equal(read(d), w + "\n");
  }
});

test("unknown for missing, garbage, secret-shaped or multi-word input", () => {
  const hostile = [
    undefined,
    "",
    "https://identity.southbag.cc/login?code=abc123&state=xyz",
    "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.sig",
    "account_bound\naccount_cleared",
    "account_bound; rm -rf /",
    "token_exchanged",
    "ACCOUNT_BOUND",
    "x".repeat(5000),
    "inw@mail.instinct.com",
  ];
  for (const h of hostile) {
    const d = mkdtempSync(join(tmpdir(), "navstate-"));
    const r = run(d, h);
    assert.equal(r.status, 0, JSON.stringify(h));
    assert.equal(read(d), "unknown\n", JSON.stringify(h));
  }
});

test("last milestone wins; file is mode 600 with no leftovers", () => {
  const d = mkdtempSync(join(tmpdir(), "navstate-"));
  run(d, "account_cleared");
  assert.equal(read(d), "account_cleared\n");
  run(d, "account_bound");
  assert.equal(read(d), "account_bound\n");
  assert.equal(statSync(join(d, "nav-state")).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(d).sort(), ["nav-state"]);
});

test("concurrent writers lose no temp files and leave a clean dir", async () => {
  // Regression: a shared temp name let a concurrent writer's rename fail or
  // pick up the other's content, silently dropping a milestone. Temp files
  // are per-process now; last completed rename wins and no debris remains.
  const d = mkdtempSync(join(tmpdir(), "navstate-"));
  const env = { SOUTHBAG_STATE_DIR: d, PATH: "/usr/bin:/bin", HOME: d };
  await Promise.all(
    Array.from({ length: 60 }, (_, i) =>
      new Promise((resolve, reject) => {
        const p = spawn(HELPER, [ENUM[i % ENUM.length]], { env });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("exit " + code))));
      })
    )
  );
  const final = read(d);
  assert.ok(ENUM.includes(final.trim()), "final value must be a real milestone, got " + JSON.stringify(final));
  assert.deepEqual(readdirSync(d).sort(), ["nav-state"], "no temp-file debris");
});

test("best-effort: unwritable state dir still exits 0", () => {
  const r = run("/proc/definitely-not-writable", "account_bound");
  assert.equal(r.status, 0);
});

test("contract: CGI call sites use only fixed enum literals", () => {
  const dir = new URL("../image/shell-extra/cgi-bin", import.meta.url).pathname;
  for (const f of ["account", "device-session"]) {
    const src = readFileSync(join(dir, f), "utf8");
    // Default path must be the shipped absolute one (fixture-overridable).
    assert.ok(src.includes('SOUTHBAG_NAV_STATE_BIN:-/usr/local/bin/southbag-nav-state'), f + " missing navbin default");
    const calls = [...src.matchAll(/"\$navbin" ([a-z_]+) \|\| true/g)];
    assert.ok(calls.length > 0, f + " has no call site");
    for (const c of calls) {
      assert.ok(ENUM.includes(c[1]), `${f}: non-literal or unknown argument ${JSON.stringify(c[1])}`);
    }
    // No raw absolute-path call may bypass the overridable variable.
    assert.ok(!/\/usr\/local\/bin\/southbag-nav-state [a-z]/.test(src), f + " has a raw absolute call");
    // The captured argument (first whitespace-delimited token after the
    // command) being in ENUM is the safety property: no expansion or
    // substitution can reach it, whatever else the line does.
  }
});
