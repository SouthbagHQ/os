// Mock-contract tests for image/shell-extra/cgi-bin/account, the origin-
// checked CGI that records which account the session lock binds to. The CGI
// is run as a plain process with the httpd-provided env (REQUEST_METHOD,
// CONTENT_LENGTH, HTTP_ORIGIN) and the request body on stdin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CGI = new URL("../image/shell-extra/cgi-bin/account", import.meta.url).pathname;
const SUB = "user-1";
const EMAIL = "kevin@southbag.cc";
const TOKEN = "valid.token_abc-123~456";

let server, origin, stateDir, runDir;

async function startMock() {
  // Separate process: spawnSync blocks this event loop (see unlock tests).
  const code = `
const { createServer } = require("node:http");
const server = createServer((req, res) => {
  if (req.url === "/api/auth/oauth2/userinfo" && req.headers.authorization === "Bearer ${TOKEN}") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sub: ${JSON.stringify(SUB)}, email: ${JSON.stringify(EMAIL)}, name: "Kevin", email_verified: true }));
    return;
  }
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "invalid_token" }));
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
  runDir = mkdtempSync(join(tmpdir(), "southbag-account-test-"));
  stateDir = join(runDir, "southbag");
});
after(() => { server.kill(); rmSync(runDir, { recursive: true, force: true }); });

function cgi({ method = "POST", originHeader, body }) {
  const payload = body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body));
  const env = {
    PATH: process.env.PATH,
    REQUEST_METHOD: method,
    CONTENT_LENGTH: String(Buffer.byteLength(payload)),
    SOUTHBAG_IDENTITY_ORIGIN: origin,
    SOUTHBAG_STATE_DIR: stateDir,
    SOUTHBAG_WGET: "wget",
  };
  if (originHeader !== undefined) env.HTTP_ORIGIN = originHeader;
  const r = spawnSync("sh", [CGI], { input: payload, env });
  return { status: r.status, out: r.stdout.toString() };
}
function httpStatus(out) {
  const m = out.match(/Status: (\d+)/);
  return m ? Number(m[1]) : 200;
}
function writeGen(g) {
  mkdirSync(join(stateDir, "device-session"), { recursive: true });
  writeFileSync(join(stateDir, "device-session", "generation"), `${g}\n`);
}
function dropGen() {
  rmSync(join(stateDir, "device-session", "generation"), { force: true });
}
// Async variant so a test can hold session.lock from another process while
// the CGI waits on it (lock-ordering cases). Same env contract as cgi().
function cgiAsync({ method = "POST", originHeader, body }) {
  const payload = body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body));
  const env = {
    PATH: process.env.PATH,
    REQUEST_METHOD: method,
    CONTENT_LENGTH: String(Buffer.byteLength(payload)),
    SOUTHBAG_IDENTITY_ORIGIN: origin,
    SOUTHBAG_STATE_DIR: stateDir,
    SOUTHBAG_WGET: "wget",
  };
  if (originHeader !== undefined) env.HTTP_ORIGIN = originHeader;
  return new Promise((resolve, reject) => {
    const p = spawn("sh", [CGI], { env });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", reject);
    p.on("close", (status) => resolve({ status, out }));
    p.stdin.end(payload);
  });
}
const SHELL_ORIGIN = "http://127.0.0.1:8080";

// Holds session.lock from another process. Returns once the lock is PROVABLY
// held (flock -n from a third process fails), with the release handle's close
// promise already attached so a fast exit cannot strand the await.
async function holdLock() {
  const lock = join(stateDir, "session.lock");
  const holder = spawn("sh", ["-c", 'exec 9>"$1"; flock -x 9; sleep 2', "sh", lock]);
  const exited = new Promise((resolve) => holder.on("close", resolve));
  for (let i = 0; i < 50; i++) {
    const probe = spawnSync("flock", ["-n", lock, "-c", "true"]);
    if (probe.status !== 0) return { holder, exited };
    await new Promise((r) => setTimeout(r, 100));
  }
  holder.kill();
  throw new Error("lock holder never acquired the lock");
}

test("shell origin + valid token records the SERVER-asserted account, mode 600", () => {
  writeGen("g1");
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: SUB, generation: "g1" } });
  assert.equal(r.status, 0);
  assert.match(r.out, /\{"recorded":true\}/);
  const note = join(stateDir, "account");
  assert.equal(readFileSync(note, "utf8"), `${SUB}\t${EMAIL}\n`);
  assert.equal(statSync(note).mode & 0o777, 0o600);
});

test("no Origin header is refused and writes nothing", () => {
  rmSync(join(stateDir, "account"), { force: true });
  const r = cgi({ body: { accessToken: TOKEN, expectedSubject: SUB } });
  assert.equal(httpStatus(r.out), 403);
  assert.ok(!existsSync(join(stateDir, "account")));
});

for (const o of [
  "https://evil.example", // attacker site
  "http://127.0.0.1:8080/", // trailing slash variant
  "http://127.0.0.1:8080.evil.example", // suffix confusion
  "http://localhost:8080", // same service, different origin spelling
  "http://127.0.0.1:8080, http://127.0.0.1:8080", // doubled header
]) {
  test(`unexpected Origin ${JSON.stringify(o)} is refused`, () => {
    rmSync(join(stateDir, "account"), { force: true });
    const r = cgi({ originHeader: o, body: { accessToken: TOKEN, expectedSubject: SUB } });
    assert.equal(httpStatus(r.out), 403);
    assert.ok(!existsSync(join(stateDir, "account")));
  });
}

test("GET is refused", () => {
  const r = cgi({ method: "GET", originHeader: "http://127.0.0.1:8080", body: "" });
  assert.equal(httpStatus(r.out), 405);
});

test("malformed token never reaches a header", () => {
  const r = cgi({ originHeader: "http://127.0.0.1:8080", body: { accessToken: 'bad"\r\nInjected: yes' } });
  assert.equal(httpStatus(r.out), 400);
});

test("Identity refusal keeps any existing note intact", () => {
  mkdirSync(stateDir, { recursive: true });
  writeGen("g1");
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: "wrong.token_abc-123~456", expectedSubject: SUB, generation: "g1" } });
  assert.equal(httpStatus(r.out), 502);
  assert.equal(readFileSync(join(stateDir, "account"), "utf8"), `${SUB}\t${EMAIL}\n`);
});

test("clear removes the note and pending challenge", () => {
  mkdirSync(stateDir, { recursive: true });
  writeGen("g1");
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  writeFileSync(join(stateDir, "twofa-cookie"), "better-auth.two_factor=x\n", { mode: 0o600 });
  writeFileSync(join(stateDir, "locked"), "", { mode: 0o600 });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { clear: true, generation: "g1" } });
  assert.match(r.out, /\{"recorded":false\}/);
  assert.ok(!existsSync(join(stateDir, "account")));
  assert.ok(!existsSync(join(stateDir, "twofa-cookie")));
  assert.ok(!existsSync(join(stateDir, "locked")));
});

// Generation fencing (under session.lock): a writer names the era it belongs
// to; a retired, unnamed, or unbound era is REJECTED (409), not delayed.

test("retired-era binding write is rejected and recreates nothing", () => {
  writeGen("g2");
  rmSync(join(stateDir, "account"), { force: true });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: SUB, generation: "g1" } });
  assert.equal(httpStatus(r.out), 409);
  assert.ok(!existsSync(join(stateDir, "account")));
});

test("retired-era clear is rejected and the note survives", () => {
  writeGen("g2");
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { clear: true, generation: "g1" } });
  assert.equal(httpStatus(r.out), 409);
  assert.equal(readFileSync(join(stateDir, "account"), "utf8"), `${SUB}\t${EMAIL}\n`);
});

test("missing generation field is rejected", () => {
  writeGen("g1");
  rmSync(join(stateDir, "account"), { force: true });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: SUB } });
  assert.equal(httpStatus(r.out), 409);
  assert.ok(!existsSync(join(stateDir, "account")));
});

test("missing generation file is rejected (era never bound)", () => {
  dropGen();
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { clear: true, generation: "g1" } });
  assert.equal(httpStatus(r.out), 409);
});

// Lock ordering 1: a reset (or a peer holding the lock) finishes and ROTATES
// the era while a stale writer waits out the lock. The fence re-checks under
// the lock, so the wait ends in a rejection, not a delayed write. The
// rotation here is simulated at the CGI level; actual manager reset/write
// lock-order integration is runtime validation, not this mock contract.
test("stale writer waiting out the lock is rejected after the era rotates", async () => {
  writeGen("g1");
  rmSync(join(stateDir, "account"), { force: true });
  const { exited } = await holdLock();
  const pending = cgiAsync({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: SUB, generation: "g1" } });
  await new Promise((r) => setTimeout(r, 300)); // CGI queued behind the lock
  writeGen("g2"); // era rotates while it waits
  const r = await pending;
  await exited;
  assert.equal(httpStatus(r.out), 409);
  assert.ok(!existsSync(join(stateDir, "account")));
});

// Lock ordering 2: the era file is REMOVED while the stale writer waits
// (teardown without a live replacement era). Same rejection, nothing written.
test("stale writer waiting out the lock is rejected after the era vanishes", async () => {
  writeGen("g1");
  rmSync(join(stateDir, "account"), { force: true });
  const { exited } = await holdLock();
  const pending = cgiAsync({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: SUB, generation: "g1" } });
  await new Promise((r) => setTimeout(r, 300));
  dropGen();
  const r = await pending;
  await exited;
  assert.equal(httpStatus(r.out), 409);
  assert.ok(!existsSync(join(stateDir, "account")));
});

// Reset failure: the bounded reset refuses and the era stays LIVE (generation
// unchanged). A current-era writer waiting out the lock is then accepted -
// the fence must not reject writers of the era that is still in force.
test("current-era writer waiting out the lock is accepted when the era still holds", async () => {
  writeGen("g1");
  rmSync(join(stateDir, "account"), { force: true });
  const { exited } = await holdLock();
  const pending = cgiAsync({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: SUB, generation: "g1" } });
  const r = await pending;
  await exited;
  assert.equal(r.status, 0);
  assert.match(r.out, /\{"recorded":true\}/);
  assert.equal(readFileSync(join(stateDir, "account"), "utf8"), `${SUB}\t${EMAIL}\n`);
});

// The expected field is a fence, never an alternative source of authority.
for (const expectedSubject of ["attacker-selected-subject", "", 123, null]) {
  test(`userinfo cannot be replaced by caller subject ${JSON.stringify(expectedSubject)}`, () => {
    writeGen("g1");
    rmSync(join(stateDir, "account"), { force: true });
    const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject, generation: "g1" } });
    assert.equal(httpStatus(r.out), expectedSubject === "attacker-selected-subject" ? 409 : 400);
    assert.ok(!existsSync(join(stateDir, "account")));
  });
}
test("missing subject fence cannot create a binding", () => {
  writeGen("g1");
  rmSync(join(stateDir, "account"), { force: true });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, generation: "g1" } });
  assert.equal(httpStatus(r.out), 400);
  assert.ok(!existsSync(join(stateDir, "account")));
});
test("mismatched subject fence preserves an existing valid binding", () => {
  writeGen("g1");
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  const r = cgi({ originHeader: SHELL_ORIGIN, body: { accessToken: TOKEN, expectedSubject: "other", generation: "g1" } });
  assert.equal(httpStatus(r.out), 409);
  assert.equal(readFileSync(join(stateDir, "account"), "utf8"), `${SUB}\t${EMAIL}\n`);
});

test('verified shell session stages a private Browser handoff and clear removes it',()=>{
 writeGen('browser-era');
 const expiresAt=Date.now()+3600000;
 let r=cgi({originHeader:SHELL_ORIGIN,body:{accessToken:TOKEN,expectedSubject:SUB,generation:'browser-era',expiresAt}});
 assert.equal(httpStatus(r.out),200,r.out);
 const file=join(stateDir,'device-session','browser-session.json');
 assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{generation:'browser-era',subject:SUB,accessToken:TOKEN,expiresAt});
 assert.equal(statSync(file).mode&0o777,0o600);
 writeFileSync(join(stateDir,'device-session','browser-handoff.json'),'private fixture');
 r=cgi({originHeader:SHELL_ORIGIN,body:{clear:true,generation:'browser-era'}});
 assert.equal(httpStatus(r.out),200);assert.ok(!existsSync(file));assert.ok(!existsSync(join(stateDir,'device-session','browser-handoff.json')));
});
test('invalid or expired handoff expiry cannot replace a verified account',()=>{
 writeGen('browser-era');
 for(const expiresAt of [0,'later',Date.now()+90000000]) {
  const r=cgi({originHeader:SHELL_ORIGIN,body:{accessToken:TOKEN,expectedSubject:SUB,generation:'browser-era',expiresAt}});
  assert.equal(httpStatus(r.out),400,r.out);
 }
});
