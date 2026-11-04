// Mock-contract tests for image/.../southbag-unlock, the PAM helper behind
// the session lock. A local HTTP server plays Southbag Identity; the helper
// is run exactly like pam_exec runs it (secret on stdin) with
// SOUTHBAG_IDENTITY_ORIGIN pointed at the mock, and its exit code is the
// verdict: 0 unlocks, anything else stays locked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELPER = new URL("../image/config/includes.chroot/usr/local/bin/southbag-unlock", import.meta.url).pathname;
const SUB = "user-1";
const EMAIL = "kevin@southbag.cc";
const PASSWORD = 'cor"rect\\horse'; // quotes and backslashes must survive JSON encoding

let server, origin, runDir, stateDir;
const requests = [];

// NOTE: the mock must be its own process - spawnSync blocks this event
// loop, so an in-process server would deadlock the helper's wget.
async function startMock() {
  const code = `
const { createServer } = require("node:http");
const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status, obj, headers = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(obj));
      };
      if (req.url === "/api/auth/sign-in/email") {
        const b = JSON.parse(body);
        if (b.email !== ${JSON.stringify(EMAIL)}) return send(401, { code: "INVALID_EMAIL_OR_PASSWORD" });
        if (b.password === ${JSON.stringify(PASSWORD)}) {
          return send(200, { redirect: false, token: "sess-token", user: { id: ${JSON.stringify(SUB)}, email: ${JSON.stringify(EMAIL)}, name: "Kevin" } });
        }
        if (b.password === "needs-totp") {
          return send(200, { twoFactorRedirect: true }, { "Set-Cookie": "better-auth.two_factor=2fa-abc; Path=/; HttpOnly; SameSite=Lax" });
        }
        if (b.password === "wrong-account") {
          return send(200, { redirect: false, token: "sess-token", user: { id: "user-OTHER", email: ${JSON.stringify(EMAIL)}, name: "Mallory" } });
        }
        return send(401, { code: "INVALID_EMAIL_OR_PASSWORD" });
      }
      if (req.url === "/api/auth/two-factor/verify-totp") {
        const b = JSON.parse(body);
        if ((req.headers.cookie ?? "").includes("better-auth.two_factor=2fa-abc") && b.code === "123456") {
          return send(200, { token: "sess-token", user: { id: ${JSON.stringify(SUB)}, email: ${JSON.stringify(EMAIL)}, name: "Kevin" } });
        }
        return send(401, { code: "INVALID_TOTP" });
      }
      send(404, { error: "not found" });
    });
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
  runDir = mkdtempSync(join(tmpdir(), "southbag-unlock-test-"));
  stateDir = join(runDir, "southbag");
  mkdirSync(stateDir);
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
});

after(() => { server.kill(); rmSync(runDir, { recursive: true, force: true }); });

function unlock(input) {
  const r = spawnSync("sh", [HELPER], {
    input: input + "\n",
    env: {
      PATH: process.env.PATH,
      SOUTHBAG_IDENTITY_ORIGIN: origin,
      SOUTHBAG_WGET: "wget",
      SOUTHBAG_STATE_DIR: stateDir,
    },
  });
  return r.status;
}

test("correct password for the signed-in account unlocks", () => {
  writeFileSync(join(stateDir, "locked"), "", { mode: 0o600 }); // locked flag
  assert.equal(unlock(PASSWORD), 0);
  assert.ok(!existsSync(join(stateDir, "locked")), "verified unlock clears the locked flag");
});

test("wrong password stays locked and keeps the locked flag", () => {
  writeFileSync(join(stateDir, "locked"), "", { mode: 0o600 });
  assert.equal(unlock("nope"), 1);
  assert.ok(existsSync(join(stateDir, "locked")), "failed unlock keeps the locked flag");
});

test("valid password for a DIFFERENT account stays locked", () => {
  assert.equal(unlock("wrong-account"), 1);
});

test("two-factor: password arms the challenge, TOTP code unlocks", () => {
  assert.equal(unlock("needs-totp"), 1); // first round refused, challenge kept
  assert.ok(existsSync(join(stateDir, "twofa-cookie")), "challenge cookie kept in tmpfs");
  writeFileSync(join(stateDir, "locked"), "", { mode: 0o600 });
  assert.equal(unlock("123456"), 0);
  assert.ok(!existsSync(join(stateDir, "locked")), "verified TOTP unlock clears the locked flag");
  assert.ok(!existsSync(join(stateDir, "twofa-cookie")), "challenge cookie single-use");
});

test("wrong TOTP stays locked", () => {
  assert.equal(unlock("needs-totp"), 1);
  assert.equal(unlock("000000"), 1);
});

test("unreachable Identity stays locked (offline fails closed)", () => {
  const r = spawnSync("sh", [HELPER], {
    input: PASSWORD + "\n",
    env: {
      PATH: process.env.PATH,
      SOUTHBAG_IDENTITY_ORIGIN: "http://127.0.0.1:1", // nothing listening
      SOUTHBAG_WGET: "wget",
      SOUTHBAG_STATE_DIR: stateDir,
    },
    timeout: 20000,
  });
  assert.equal(r.status, 1);
});

test("missing account note stays locked (nothing to verify against)", () => {
  const empty = mkdtempSync(join(tmpdir(), "southbag-unlock-empty-"));
  const r = spawnSync("sh", [HELPER], {
    input: PASSWORD + "\n",
    env: {
      PATH: process.env.PATH,
      SOUTHBAG_IDENTITY_ORIGIN: origin,
      SOUTHBAG_WGET: "wget",
      SOUTHBAG_STATE_DIR: join(empty, "southbag"),
    },
  });
  assert.equal(r.status, 1);
  rmSync(empty, { recursive: true, force: true });
});

test("no secrets in helper argv", () => {
  // The design contract: the password travels on stdin and in a tmpfs
  // --post-file, never as an argument. The helper only ever invokes wget
  // with --post-file; assert the invoked argv by tracing with a stub.
  const binDir = mkdtempSync(join(tmpdir(), "southbag-wget-trace-"));
  writeFileSync(join(binDir, "wget"), '#!/bin/sh\nfor a in "$@"; do case "$a" in *cor*rect*) echo ARGV-LEAK >&2; exit 9;; esac; done\nexec /usr/bin/wget "$@"\n', { mode: 0o755 });
  const r = spawnSync("sh", [HELPER], {
    input: PASSWORD + "\n",
    env: {
      PATH: process.env.PATH,
      SOUTHBAG_IDENTITY_ORIGIN: origin,
      SOUTHBAG_WGET: join(binDir, "wget"),
      SOUTHBAG_STATE_DIR: stateDir,
    },
  });
  assert.equal(r.status, 0, "unlock succeeds with tracing stub, no ARGV-LEAK");
  rmSync(binDir, { recursive: true, force: true });
});
