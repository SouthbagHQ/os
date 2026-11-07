# Source-only worker safety preparation

Review candidate only. This patch is not applied by any package/image build.
It does not change the qualified source/binary/package hashes or the dormant
ci1 image. No device permission, activation, worker startup or restart is added.

Baseline corresponding source SHA256:
28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be

Patch SHA256:
ee2cde05b64d4f80bc9c490b0366e96e83cf32807d81f02d4e0d2db809fc4b44

## Candidate changes

- Inject-only worker compiles out its IPC listener and engine IPC funnel.
  Common IPC constructors reject before transport. The no-funnel change is
  necessary: retaining a disconnected receiver would panic the engine.
- Inject-only Linux UI compiles out notification transport independently of
  configuration, instead of relying only on show_notifications:false.
- Detector read error, EOF, partial record, SYN_DROPPED, EPOLLERR or EPOLLHUP invalidates the inject-only
  detector rather than continuing with a partial/uncertain input set. This
  does not by itself establish whole-process or input-FD cleanup.
- A test-only one-way topology policy records opaque snapshot tokens and
  permanently requests inhibit on generation change, set change, device event,
  monitor gap/loss or read failure. Unchanged means no observed change, never
  permission to read. It selects/trusts no device, opens nothing and has no
  operational watcher or grant wiring. No rearm/resume method exists.
- A channel-only UI unwind test confirms loss of the engine-owned remote
  unblocks Linux UI as an error. It does not start a worker or display server.

## Non-reader tests

Native Debian13, networkless build environment, no worker entrypoint invoked:

- Inject-only CLI14/14.
- Inject-only detector17/17; non-inject detector12/12.
- Inject-only UI3/3; non-inject UI2/2.
- Non-inject CLI13/13 with wayland, disabled clipboard and no modulo. This
  checks conditional paths, not a complete stock desktop build.

Commands from extracted baseline plus this patch:

```
cargo test --locked -p espanso --no-default-features --features vendored-tls,southbag-inject-only
cargo test --locked -p espanso-detect --no-default-features --features wayland,southbag-inject-only,espanso-info/wayland
cargo test --locked -p espanso-detect --no-default-features --features wayland,espanso-info/wayland
cargo test --locked -p espanso-ui --no-default-features --features southbag-inject-only
cargo test --locked -p espanso-ui --no-default-features
cargo test --locked -p espanso --no-default-features --features vendored-tls,wayland,espanso-clipboard/disabled
```

## Remaining gates

A privileged physical-identity resolver and opened-device validation must own
any per-generation device set; opaque tokens or event numbers are not trust.
Path swaps and device-number reuse must deny. Preserve compositor access.
Add/remove/change events, overflow, watcher loss or uncertain state must inhibit
and invalidate the generation, never silently extend/restart it. Define modifier
reconciliation separately; do not assume released keys after unplug.

Actual worker no-socket/process/input-FD cleanup, crash/restart, finite expansion,
matched graphical/focus and held-modifier tests remain unqualified for a new
candidate. Physical device identity/DAC/virtual exclusion/hotplug need a
representative hardware environment. The topology primitive is not that watcher.
A returned detector error alone is not a full-unit stop proof. Authentication,
consent and activation remain held. No qualification or permission follows from
these compile/unit-test results.


## Host fixture cleanup

Run the Node contracts with `python3 scripts/test-child-cleanup.py node --test
tests/*.test.mjs` on Linux. The runner reports and kills only descendants
adopted from that invocation, uses PID-bound handles with parentage rechecks,
and reaps to zero. Failure codes remain failures; unverified cleanup fails.
The full host suite passed91/91 with six abandoned inert fixture sleepers
cleaned and zero remaining children. Runner fixtures3/3 verify detached-child
cleanup, no-descendant cleanup and failure-code preservation. This changes
only test execution hygiene, not product stop/cleanup semantics.
