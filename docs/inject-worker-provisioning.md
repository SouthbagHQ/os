# Dormant dedicated worker candidate

This is provisioning work, not permission to activate a keyboard reader.
The canonical unit is southbag-espanso.service, matching the stop-only broker.
It uses a dedicated system uid/group with nologin and no additional groups.
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
