#!/usr/bin/env bash
# Native Debian 13 source-build candidate. Never runs the worker. This is
# deliberately separate from the hash-allowlisted .deb packaging gate.
# Usage: build-kevin-source.sh SOURCE_TAR OUTDIR
set -euo pipefail
source=${1:?}; out=${2:?}; phase=${3:-all}
case "$phase" in all|test|build) ;; *) echo 'phase must be all, test or build' >&2; exit 1;; esac
source=$(realpath "$source")
. /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 && $(uname -m) = x86_64 ]] || {
 echo 'Build only in an amd64 Debian 13 environment, not against host libraries' >&2; exit 1;
}
[[ $(sha256sum "$source" | cut -d' ' -f1) = 9d00e6cd1b2917c63022664426c8f25e174644711882c1671894a60bb5e4d0d9 ]] || {
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
if [[ "$phase" != build ]]; then
cargo test --locked -p espanso --no-default-features --features "$features"
cargo test --locked -p espanso --no-default-features --features vendored-tls,wayland,espanso-clipboard/disabled
cargo test --locked -p espanso-inject --no-default-features --features southbag-inject-only,espanso-info/wayland
cargo test --locked -p espanso-inject --no-default-features --features wayland,espanso-info/wayland
cargo test --locked -p espanso-engine --no-default-features --features southbag-inject-only
cargo test --locked -p espanso-engine --no-default-features
cargo test --locked -p espanso-detect --no-default-features --features wayland,southbag-inject-only,espanso-info/wayland
cargo test --locked -p espanso-detect --no-default-features --features wayland,espanso-info/wayland
cargo test --locked -p espanso-ui --no-default-features --features southbag-inject-only
cargo test --locked -p espanso-ui --no-default-features
fi
[[ "$phase" != test ]] || exit 0
cargo build --locked -p espanso --release --target x86_64-unknown-linux-gnu --no-default-features --features "$features"
binary=${CARGO_TARGET_DIR:-target}/x86_64-unknown-linux-gnu/release/espanso
readelf -d "$binary" >"$out/espanso.needed.txt"
if grep -Eq 'NEEDED.*(wx|gtk|wayland|X11|stdc\+\+)' "$out/espanso.needed.txt"; then
 echo 'Unexpected graphical/C++ runtime dependency' >&2; exit 1
fi
install -m 755 "$binary" "$out/espanso-candidate"
sha256sum "$out/espanso-candidate"
echo 'Candidate built, not installed or executed. Different hash requires independent validation; never edit the packaging allowlist merely to make it pass.'
