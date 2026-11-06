// Mock-contract tests for image/.../southbag-face-unlock. A local HTTP
// server plays Southbag Identity; the helper is run with a captured photo
// file and its exit code is the verdict: 0 unlocks, anything else stays
// locked. Face unlock is a photo match against the enrolled photo - the
// account's faceId must already be recorded (by southbag-unlock from
// Identity's own credential endpoint) and the returned user id must be
// exactly the recorded account.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELPER = new URL("../image/config/includes.chroot/usr/local/bin/southbag-face-unlock", import.meta.url).pathname;
const SUB = "user-1";
const EMAIL = "kevin@southbag.cc";
const FACEID = "face-123";

let server, origin, runDir, stateDir, photo;

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
      if (req.url === "/api/auth/sign-in/southbag-id") {
        const b = JSON.parse(body);
        if (typeof b.photo !== "string" || !b.photo.startsWith("data:image/jpeg;base64,")) {
          return send(400, { code: "INVALID_PHOTO" });
        }
        if (b.faceId === ${JSON.stringify(FACEID)}) {
          return send(200, { token: "sess-face", user: { id: ${JSON.stringify(SUB)}, email: ${JSON.stringify(EMAIL)} } }, { "Set-Cookie": "better-auth.session_token=sess-face; Path=/; HttpOnly" });
        }
        if (b.faceId === "face-other") {
          return send(200, { token: "sess-face", user: { id: "user-OTHER", email: "mallory@southbag.cc" } });
        }
        return send(401, { code: "FACE_MISMATCH" });
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
  runDir = mkdtempSync(join(tmpdir(), "southbag-face-test-"));
  stateDir = join(runDir, "southbag");
  mkdirSync(stateDir);
  writeFileSync(join(stateDir, "account"), `${SUB}\t${EMAIL}\n`, { mode: 0o600 });
  writeFileSync(join(stateDir, "faceid"), `${FACEID}\n`, { mode: 0o600 });
  writeFileSync(join(stateDir, "locked"), "");
  photo = join(runDir, "photo.jpg");
  writeFileSync(photo, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024, 0x61)]));
});

after(() => { server.kill(); rmSync(runDir, { recursive: true, force: true }); });

function faceUnlock(args, envExtra = {}) {
  const r = spawnSync("sh", [HELPER, ...args], {
    env: { PATH: process.env.PATH, HOME: runDir, SOUTHBAG_IDENTITY_ORIGIN: origin, SOUTHBAG_STATE_DIR: stateDir, ...envExtra },
  });
  return r;
}

test("enrolled face unlocks: photo accepted, user id matches, lock flag cleared, photo deleted", () => {
  const r = faceUnlock([photo]);
  assert.equal(r.status, 0, r.stderr?.toString());
  assert.equal(existsSync(join(stateDir, "locked")), false);
  assert.equal(existsSync(photo), false, "captured photo must be deleted on exit");
});

test("photo for a different account stays locked", () => {
  writeFileSync(join(stateDir, "faceid"), "face-other\n");
  writeFileSync(join(stateDir, "locked"), "");
  const r = faceUnlock([photo]);
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(join(stateDir, "locked")), true);
  writeFileSync(join(stateDir, "faceid"), `${FACEID}\n`);
});

test("no recorded faceId stays locked (enrolment never cached)", () => {
  rmSync(join(stateDir, "faceid"), { force: true });
  const r = faceUnlock([photo]);
  assert.notEqual(r.status, 0);
  writeFileSync(join(stateDir, "faceid"), `${FACEID}\n`);
});

test("offline stays locked", () => {
  const r = faceUnlock([photo], { SOUTHBAG_IDENTITY_ORIGIN: "http://127.0.0.1:1" });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(photo), false, "photo must still be deleted on failure");
});

test("oversized photo is refused before posting", () => {
  const big = join(runDir, "big.jpg");
  writeFileSync(big, Buffer.alloc(900000, 0x61));
  const r = faceUnlock([big]);
  assert.notEqual(r.status, 0);
});

test("missing photo argument stays locked", () => {
  const r = faceUnlock([]);
  assert.notEqual(r.status, 0);
});

test("face mismatch from Identity stays locked", () => {
  writeFileSync(join(stateDir, "faceid"), "face-unknown\n");
  const r = faceUnlock([photo]);
  assert.notEqual(r.status, 0);
  writeFileSync(join(stateDir, "faceid"), `${FACEID}\n`);
});
