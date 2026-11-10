# Customer/root broker boundary: local candidate

The shipped broker runs at boot as root and stores state under mode-0700
/run/southbag-input-broker. The lock runs as customer and invokes the broker
script directly. Every script verb runs chmod and opens a lock in the root
state directory. In an actual networkless image, root reports generation=1
state=inhibited, while customer current and inhibit both fail at chmod. Lock
fails closed before creating its locked flag. Same-identity fixtures miss it.

Do not fix this by making state customer-writable, allowing arbitrary
systemctl, running the lock as root or making a shell script setuid.

## Narrow stop-only transport

- Keep the existing shell broker private to root for begin-generation and
  serialized stop/cgroup verification. It still has no activation path.
- A root-owned socket-activated broker endpoint authenticates the local peer
  using kernel peer credentials against the installed customer uid (plus
  root). No request-provided uid, environment, path or unit is trusted.
- A bounded protocol accepts only current and inhibit with a decimal current
  generation. No start, restart, enable, generation creation or auth verb.
- The handler executes one fixed root-owned broker path with a fixed minimal
  environment. All test adapters stay outside the deployed handler.
- Responses expose only generation, inhibited/failed state and success/failure.
  No device data, account facts, credentials, clipboard or key events.
- Root state remains 0700/0600. Missing socket/service, malformed/truncated or
  oversized messages, unauthorized uid, stale generation, timeout, missing
  adapter and cgroup uncertainty fail closed. Concurrent calls serialize via
  the existing root lock; rate/concurrency limits bound denial of service.
- The customer-facing client must validate the root server peer and reply
  shape. A fake socket or caller-owned response never authorizes a prompt.
- Packaging must install client, handler, socket/service, correct ownership,
  modes and boot ordering together. Lock updates alone are not deliverable.

The native client/handler is in opt/southbag-broker-src; image hook 0016 builds
it and the lock package includes it with the broker script and units. Socket
activation accepts at most eight concurrent requests (four per uid); each
connection authenticates kernel peer credentials. The handler deadline is
40 seconds after a bounded eight-second request read. The client gives it
50 seconds. Only fixed executable/arguments and a fixed minimal environment
reach the root broker. The service is killed as a cgroup on timeout.

The original guest regression fails on the shipped image and passes with the
candidate package. Host protocol tests compile a test-only uid/path adapter;
these do not substitute for root/customer guest tests. Root-state modes stay
0700/0600. No worker is delivered or started by the package.

The lock package intentionally owns the effective swaylock configuration.
Package-owned dpkg diversions preserve Debian's prior files and restore them
on removal instead of forcing an overwrite. Package installation enables
only the inhibit-only broker/socket for next boot, never starts a worker.
Removal stops/disables the request socket before removing the client.

Qualification is narrow: actual-image package install/upgrade/removal passed,
including original-config hash restoration and socket shutdown on removal.
The real customer/root regression, unauthorized uid, stale generation,
caller-environment isolation, 13 hostile protocol cases and missing-socket
lock denial passed. An inert sleep-only service demonstrated populated=1,
successful stop/cgroup removal, and a hung ExecStop failed closed in 17 seconds
with failed state/populated=1. Explicit cleanup then inhibit recovered. No input
reader or credential prompt was used. Existing tests: 139/139, Svelte 0/0;
new IPC host tests: 8/8. Rebuilt-image/boot remains a separate gate. This does
not close worker provisioning or auth gates.

## Worker provisioning remains separate

The old draft uses southbag-inject.service, while the combined broker watches
southbag-espanso.service. Its binary path is a placeholder. Neither should be
activated. Select one canonical unit only with pinned binary delivery and
root-owned read-only config; dedicated uid with no seat/input/video groups;
uinput access limited to that uid; and trusted per-physical-keyboard grants.
Keep compositor access intact. Exclude virtual devices, revoke on lock/signout,
stop on hotplug and reconcile held modifiers before any restart. Device cgroup
input-major policy is not a per-device DAC grant. Real service/cgroup, crash,
hotplug and graphical-session tests remain required.

## Signed-in journey remains held

Fresh isolation and password activeElement metadata are narrow preconditions,
not auth readiness. Any later test needs a clean disposable local account,
credential-safe entry without readers or screenshots, strictly local issuer,
registration, callback, token and JWKS routes, PKCE/state/nonce checks and a
verified stop/cgroup-empty barrier before credential UI. Prior consent denials
remain binding: do not retry, preseed consent or bypass it. The current diagnostic
proxy's auth restrictions must not be relaxed under this planning work.

## Stop probe deadline/recheck correction

The broker now gives initial/final status, ControlGroup queries and stop one
monotonic budget, rather than allowing an initial hung probe or a second wait
budget to exceed the deadline. Each adapter call is timeout-bounded; cleanup
has a200ms kill grace. Initially inactive units also receive final status and
both captured/current cgroup checks. Unexpected paths deny. This is not atomic
exclusion against an external authorized restart and does not qualify new
worker input/output-FD, modifier, driver or physical-device behavior.

Host regressions cover initial status/show hangs, unit reappearance and several
slow probes sharing one budget. Full Node94/94 passed with zero remaining
fixture descendants. `tests/guest/broker-deadline.sh CANDIDATE_BROKER` qualifies
only a separately named inert sleep unit in a disposable guest. Independently
observed: inert parent/child stop and cgroup removal; hung probe failed at8s;
explicit later recovery; a real inert-unit reappearance denied; hung ExecStop
failed at9s with an8s test budget plus scheduling/cleanup allowance. A2s trial
failed closed on the slow emulated guest, not a positive2s stop qualification.
The installed dormant worker stayed inactive/MainPID0/ExecCondition=false.
Existing ci1 artifacts are unchanged and retain only their original scope.
