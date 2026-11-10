#!/usr/bin/env bash
# Native Debian 13 source-build candidate. Never runs the worker. This is
# deliberately separate from the hash-allowlisted .deb packaging gate.
# Usage: build-inject-source.sh SOURCE_TAR OUTDIR
set -euo pipefail
source=${1:?}; out=${2:?}
source=$(realpath "$source")
. /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 && $(uname -m) = x86_64 ]] || {
 echo 'Build only in an amd64 Debian 13 environment, not against host libraries' >&2; exit 1;
}
[[ $(sha256sum "$source" | cut -d' ' -f1) = 28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be ]] || {
 echo 'Unrecognized source archive' >&2; exit 1;
}
for tool in cargo rustc gcc g++ pkg-config readelf; do command -v "$tool" >/dev/null; done
mkdir -p "$out"; out=$(realpath "$out")
build=$(mktemp -d); trap 'rm -rf "$build"' EXIT
tar -xzf "$source" -C "$build" --no-same-owner
cd "$build"
# This feature set excludes modulo, GUI/clipboard/Wayland providers and
# daemon welcome UI. Unit tests do not open event devices or start workers.
features=vendored-tls,southbag-inject-only
cargo test --locked -p espanso --no-default-features --features "$features"
cargo test --locked -p espanso-clipboard --no-default-features --features wayland,disabled
cargo build --locked -p espanso --release --target x86_64-unknown-linux-gnu --no-default-features --features "$features"
binary=${CARGO_TARGET_DIR:-target}/x86_64-unknown-linux-gnu/release/espanso
readelf -d "$binary" >"$out/espanso.needed.txt"
if grep -Eq 'NEEDED.*(wx|gtk|wayland|X11|stdc\+\+)' "$out/espanso.needed.txt"; then
 echo 'Unexpected graphical/C++ runtime dependency' >&2; exit 1
fi
install -m 755 "$binary" "$out/espanso-candidate"
sha256sum "$out/espanso-candidate"
echo 'Candidate built, not installed or executed. Different hash requires independent validation; never edit the packaging allowlist merely to make it pass.'
