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

test("shell origin + valid token records the SERVER-asserted account, mode 600", () => {
  const r = cgi({ originHeader: "http://127.0.0.1:8080", body: { accessToken: TOKEN } });
  assert.equal(r.status, 0);
  assert.match(r.out, /\{"recorded":true\}/);
  const note = join(stateDir, "account");
  assert.equal(readFileSync(note, "utf8"), `${SUB}\t${EMAIL}\n`);
  assert.equal(statSync(note).mode & 0o777, 0o600);
});

test("no Origin header is refused and writes nothing", () => {
  rmSync(join(stateDir, "account"), { force: true });
  const r = cgi({ body: { accessToken: TOKEN } });
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
    const r = cgi({ originHeader: o, body: { accessToken: TOKEN } });
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
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  const r = cgi({ originHeader: "http://127.0.0.1:8080", body: { accessToken: "wrong.token_abc-123~456" } });
  assert.equal(httpStatus(r.out), 502);
  assert.equal(readFileSync(join(stateDir, "account"), "utf8"), `${SUB}\t${EMAIL}\n`);
});

test("clear removes the note and pending challenge", () => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  writeFileSync(join(stateDir, "twofa-cookie"), "better-auth.two_factor=x\n", { mode: 0o600 });
  writeFileSync(join(stateDir, "locked"), "", { mode: 0o600 });
  const r = cgi({ originHeader: "http://127.0.0.1:8080", body: { clear: true } });
  assert.match(r.out, /\{"recorded":false\}/);
  assert.ok(!existsSync(join(stateDir, "account")));
  assert.ok(!existsSync(join(stateDir, "twofa-cookie")));
  assert.ok(!existsSync(join(stateDir, "locked")));
});
