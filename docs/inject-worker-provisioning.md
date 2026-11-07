# Dormant dedicated worker candidate

This is provisioning work, not permission to activate a keyboard reader.
The canonical unit is southbag-espanso.service, matching the stop-only broker.
It uses a dedicated system uid/group with nologin and no additional groups.
The package validates any existing identity before unpacking, then creates and
validates a missing identity at configuration time. Explicit shell branches
reject root/ordinary/customer ids, missing customer and unsafe account posture;
the check does not rely on set -e behavior inside an AND-list.
Its condition is unconditionally false, it has no enablement section, and it
has neither cgroup device allow entries nor input/uinput DAC grants. Rules
are empty. The customer/compositor keeps its existing device access.

The package recipe accepts one exact minimal binary and corresponding source
archive, both SHA-256 allowlisted. It installs neither a downloader nor a
self-updater. The matching source is copied beside the runtime package, not
into the image. Keep both artifacts together if distributing the candidate.
The source archive excludes local diagnostic records and the host-specific
.cargo/config.toml. packaging/espanso-inject-only.patch contains only product
changes against upstream a87d1723f47a59e38d370e2f0c636d66d568b8f6. The runtime includes
the GPL license and provenance. No artifact is a deployment approval.

Minimal features are vendored-tls,southbag-inject-only with no defaults.
Modulo/forms/search is excluded; this is not a stock Espanso desktop build.
The candidate links only baseline trixie libraries, without wx/GTK/C++ shared
libraries. Compilation and 13 CLI unit tests passed in the target sysroot.
Native Debian 13 build prerequisites are Rust/Cargo, build-essential,
pkg-config, libxkbcommon-dev, libbz2-dev and libssl-dev. The separate
build-inject-source.sh produces a new candidate from the pinned source; its
native Debian 13 build passed 13 CLI tests, one disabled-clipboard test and
loader checks with network disabled. The native candidate hash differs from the
earlier sysroot-built runtime artifact; it has not replaced the package allowlist.
Cross-environment byte reproducibility and candidate runtime qualification remain
open. The candidate CI workflow reconstructs from pinned public upstream
plus our product patch and verifies the exact archive hash. It builds a candidate
binary and uploads source, binary, tool versions and digests only. It never
installs a package, runs the worker, grants device access or publishes an update.
A new candidate hash must pass review, not silently replace the known binary.
The .deb builder intentionally refuses unknown artifacts.

Networkless shipped-image tests passed normal install, replacement, removal
and reinstall, loader resolution, dedicated uid/groups, explicit condition
skip with MainPID=0, absent process, denied event-device reads and denied
uinput writes. No worker binary was executed by these guest tests. Removal
keeps the allocated uid to avoid reassigning ownership to another identity.
These package tests are not a rebuilt-image integration pass for this lane.

Open gates: CI-native source build and exact delivery integration, dedicated
worker runtime/no-socket qualification, physical-device identity and bounded
DAC grants, virtual-device exclusion, hotplug removal/addition, held-modifier
safety, finite expansion parity, emergency stop and empty descendant/FD proof,
and graphical/focus qualification. Authentication and consent remain held.
The false condition must stay until those independent gates pass and the
activation authority is separately established. Nothing here adds a broker
start verb or changes its root-only state/stop-only authority.

## Optional offline image input

Image builds default to no worker binary. For a diagnostic image containing
only the exact guest-tested package, set SOUTHBAG_INJECT_DEB and
SOUTHBAG_INJECT_SOURCE to local artifact paths. The staging helper refuses
unknown hashes, requires the corresponding source, clears stale inputs and
copies source beside the output image. Hook 0013 installs the package after
customer creation, not in live-build's earlier package phase, then removes
the staged installer. It does not enable/start the unit or grant devices.
Unqualified CI candidates are deliberately rejected. One separately qualified
exact CI binary now has a versioned ci1 lane, described below. No network fetch
or self-updater is added. Rebuilt-image inclusion/boot qualification remains
open until an image using those exact inputs has been checked.

## Separately qualified exact ci1 image lane

CI run 42316164025/artifact 13551346517 built binary SHA256
7b017fcaefd6f7e7137840be54e094d263c4fcdcca3de672335200190bcce10c from
exact source28fc7630.... Its source/archive/manifest, ELF and loader checks
passed. A fresh networkless guest passed identity/device denials, false-condition
skip, unsafe-group preinstall refusal/recovery and install/removal/reinstall,
without executing the worker. It is packaged separately as
2.4.1+southbag.1.minimal.ci1, not substituted for the old sysroot artifact.
Fixed timestamps and gzip packaging produce the same envelope on Ubuntu and
Debian package tools: SHA256
3b63aeaa438de7589ebd2ce6823ad01fcb0762e3d635da6c23986e13879e9e50.
That exact envelope also passed the guest install and no-process checks.

ISO manual dispatch has an optional dormant_ci1 boolean, default false. It uses
Actions artifact download for one fixed run/name, checks binary/source hashes,
builds the separately versioned package, then independently checks its exact
package hash before image staging. No new comment, public upload, release or
binary in source history is required. No arbitrary run, artifact or hash input
is accepted. Artifact expiry/download permission errors fail the build rather
than selecting a newer candidate. Source accompanies the ISO output. This is a
diagnostic image path, not activation permission or a deployment. A complete
rebuilt-image inclusion/boot check remains open until the exact output is tested.
