# Source-only worker safety preparation

Review candidate only. This patch is not applied by any package/image build.
It does not change the qualified source/binary/package hashes or the dormant
ci1 image. No device permission, activation, worker startup or restart is added.

Baseline corresponding source SHA256:
28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be

Patch SHA256:
1cceb2d991da9135e71a90ec68e9487807c1a4969b0a551276c4be6dd3c52ccc

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

- Inject-only CLI23/23.
- Inject-only detector20/20; non-inject detector12/12.
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


## Finite-profile and ordered-monitor review extension

The later source-only candidate validates all loaded match groups before
engine/detector setup, not just the currently active group. Every config must
use explicit Inject backend. Variables of any type, regex/empty triggers,
images, markup/templates/cursor markers and clipboard effects deny. Built-in
debug/search/restart actions are absent in inject-only mode. Its exact production
renderer has zero registered dynamic extensions; an inert test verifies literal
Unicode output and rejects every standard dynamic extension type. This is not
runtime expansion or graphical-field qualification. Shipped rules stay empty.

The test-only topology primitive also rejects missing, duplicate, out-of-order,
gapped and overflowed abstract monitor-local cursors. These are not Linux global
uevent sequence numbers. No operational watcher, physical trust resolver, grant,
activation, rearm or resume is wired. A clean synthetic observation never grants
permission to read devices. Hardware and real-worker lifecycle gates stay open.


The inject-only engine never raises CAP_DAC_OVERRIDE. Its worker handler no
longer asks to retain capability setup. A no-desktop-probe app-info provider
replaces environment-selected wlrctl/kdotool/niri provider discovery. Inert tests
exercise the actual provider and capability policy without process/device or
transport initialization. These are source changes, not privilege/runtime proof.
