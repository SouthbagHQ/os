# Device-only signout draft, not release-ready

Status 2026-11-05 (successor): scope-adapter migration done on host. OS suite
51 pass (device-session 6 rewritten for systemd user scopes; account 11,
face-unlock 7, identity-auth 7, session-signout 2, unlock 18); Browser draft
37 tests / check 41 files pass. These are preparatory contract checks, not
runtime qualification.

Manager (image/.../southbag-device-session) now: apps start only inside
tracked user scopes (KillMode=control-group) with a child-written ready
marker from inside the scope before the unit is recorded; failed starts stop
the half-started unit so no untracked scope leaks; stop is bounded
(STOP_DEADLINE) and fail-closed (note kept for retry, blocked flag kept,
profiles kept); after stops a /proc scan refuses the profile wipe while any
same-user process still references the private root (covers writers that
escaped their scope). Host fixtures emulate systemctl/systemd-run contracts
only; they cannot prove cgroup retention - that stays an image test.

Image-proven so far (predecessor, exact 7263ded ISO + diagnostic draft):
systemd user scopes work in the seat; setsid sleep descendant reset clean;
real Cog app 8 PIDs recursively contained and reset clean with private WPE
storage; 3 immediate stock Browser launch/reset races all clean (child-ready
handshake). NOT proven: cause of the one anomalous launch (Electron main +
network PIDs observed outside the recorded scope, profile dir reappeared
after reset0); patched Browser guard runtime (positional .asar is ignored by
stock Electron - needs resources/app.asar replacement on a separate
diagnostic copy); crash/boot recovery; old default-profile migration;
account switch; late OAuth binding; causal shell signout with Browser open.

Other unresolved: abrupt reset has no user-visible failure recovery; startup
after blocked reset intentionally stays blocked; visible WPE apps may remain
if escaped (manager now refuses wipe but the user sees stale windows);

Escaped-writer scan detail: the /proc scan skips the manager's own ancestor
chain for the cmdline heuristic ONLY. Operator launch command lines
legitimately carry the private root in argv (e.g. --user-data-dir=$root/browser),
so without the ancestor exclusion any reset invoked through such a shell
false-positives and fails closed forever. Ancestors are never exempt from the
fd and maps checks: a real open handle or memory mapping under the root always
blocks the wipe, whoever holds it. The scan checks cmdline, /proc/pid/fd links
and /proc/pid/maps for references under the root. It is a seatbelt, not proof
that every writer is gone: later opens, renamed/deleted paths, foreign mounts
and /proc visibility races cannot be closed at this layer - the tracked-cgroup
stop is the primary mechanism and the scan backs it up (regression tests 6-8
cover escaped writer, ancestor argv, and ancestor-with-open-fd; verified
in-guest: reset through a root-carrying shell succeeds, real Browser
stop+wipe+relaunch-gating cycle passes on the live image).
profile permission locking; audio/native face/hardware unchanged.

Espanso staged support is OFF and owned by the lock worker; raw-input root
broker architecture unresolved; do not activate from this supervisor.
Frozen 7263ded ISO unchanged. Local worktree only; sole publisher via main
owns any future PR update.

State-path alignment (load-bearing production interface): the patched
Browser's device guard (src/main/device-account.js) reads
account/generation/blocked from os.homedir() (~/.local/share/southbag), NOT
from $SOUTHBAG_STATE_DIR. Production must keep the manager's state dir and
the Browser's home-aligned state at the same location, or every launch
quits at startup by design (verified in-guest both directions: mismatch
quits, match runs). This contract must be carried through the draft and the
host test suite, not left implicit.

## Host test carry-through (10/10)
Tests 9-10 added: launch env chain (SOUTHBAG_OS=1 + device generation reach the
scoped process; static assert every browser launch line in cgi-bin/launch
injects env SOUTHBAG_OS=1, cog intentionally unmarked) and HOME alignment
(without SOUTHBAG_STATE_DIR, state derives at $HOME/.local/share/southbag with a
full launch/reset cycle). Guarded vs legacy unguarded harness results are
distinguished in reports.

## Blocked-reset recovery (design + implementation, unqualified on image)
Blank-forever boot after a blocked reset was a defect. Fail-closed recovery:
- Manager `recovery` case: allowed ONLY while blocked with generation present;
  starts a tracked scope running cog on /recovery.html with a VOLATILE profile
  on runtime tmpfs (outside the wiped root, so the surface can never trip the
  escaped-writer scan or hold wiped data). No old session apps, no account or
  credential UI. Test-only SOUTHBAG_DEVICE_COG adapter added (image default
  /usr/bin/cog unchanged); shell case uses it too.
- Supervisor (southbag-shell): blocked branch runs the recovery surface instead
  of the refusing shell loop; when blocked clears (user-triggered reset retry
  via the page) it stops the recovery scope and the normal shell starts. No
  automatic unblock: recovery is the user pressing "Finish cleanup", which
  re-runs the same bounded reset through the existing device-session CGI.
- Page: public/recovery.html (static, no credentials, explains state, retry on
  503). Espanso hook point: before any recovery/lock surface, the input-capture
  stop barrier (broker inhibit / emergency stop) applies once that lane lands;
  espanso is OFF in the image so the surface is safe today.
- Host test 11 covers gating (refused unblocked / allowed blocked), volatile
  profile placement, and reset retry completing while the surface runs.
Not yet image-proven: recovery page render + full blocked-crash-recovery boot
cycle (crashboot b1-b4 extended) remain queued.

## Recovery surface security notes
- Origin/CSRF: the reset CGI requires POST + HTTP_ORIGIN exactly
  http://127.0.0.1:8080, and the request body must carry the current
  generation, which a cross-origin page cannot read (the ?generation route is
  equally origin-guarded and CORS blocks cross-origin reads). The generation
  therefore doubles as a CSRF token against cross-origin callers. It is NOT
  an authority boundary against a same-origin old session: a blocked state
  usually means an old scope (including the old shell, which legitimately
  fetched the generation during sign-out) is still alive and could re-POST
  the reset. That residual is bounded by construction: a re-POST while any
  writer survives fails closed, and a re-POST after writers are gone only
  completes the cleanup the original sign-out already authorized. No new
  authority is granted to the old session, but do not rely on the absence of
  old scopes while blocked - rely on the writer barrier instead.
- No old-session bridge: the recovery profile is fresh runtime tmpfs created
  by the manager (XDG_DATA_HOME/XDG_CACHE_HOME under XDG_RUNTIME_DIR), never
  under the private root, and the scope is launched WITHOUT
  SOUTHBAG_DEVICE_GENERATION, so the surface is not a session-bound app and
  carries no cookies/storage/history from any previous session.
- Concurrency: duplicate Finish-cleanup clicks serialize on the manager
  flock; exactly one reset succeeds, the loser fails fast on the missing
  generation (host test 12). After success the generation route 503s, which
  the page treats as an error until the supervisor replaces the surface
  (sub-second; documented minor UX wart, safe direction).
- Response delivery: the reset route never stops the recovery scope (the
  stop loop covers app-*.unit and shell.unit only), and the supervisor waits
  2s after blocked clears before stopping the surface, so the 204 lands.

## Publication gating note
The branch is self-contained for the manager/recovery layer ONLY. The base
account CGI and shell signout journey (cgi-bin/account, identity.ts,
main.ts, cog-host, account/signout tests) are NOT yet manager-integrated in
this branch's base - the whole-OS account journey may still be inconsistent
until the account lane lands explicitly. NOT publication ready.
