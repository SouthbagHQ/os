#!/usr/bin/env bash
# Apply and unit-test the separate review patch. No worker invocation,
# package/image output, artifact replacement, activation or device grant.
set -euo pipefail
source=${1:?Usage: test-inject-safety-preparation.sh SOURCE_TAR}
source=$(realpath "$source")
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 && $(uname -m) = x86_64 ]] || exit 2
[[ $(sha256sum "$source" | cut -d' ' -f1) = 28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be ]] || exit 2
patch=$repo/packaging/inject-safety-preparation.patch
[[ $(sha256sum "$patch" | cut -d' ' -f1) = ee2cde05b64d4f80bc9c490b0366e96e83cf32807d81f02d4e0d2db809fc4b44 ]] || exit 2
build=$(mktemp -d); trap 'rm -rf "$build"' EXIT
tar -xzf "$source" -C "$build" --no-same-owner
cd "$build"
git apply --check "$patch"
git apply "$patch"
cargo test --locked -p espanso --no-default-features --features vendored-tls,southbag-inject-only
cargo test --locked -p espanso-detect --no-default-features --features wayland,southbag-inject-only,espanso-info/wayland
cargo test --locked -p espanso-detect --no-default-features --features wayland,espanso-info/wayland
cargo test --locked -p espanso-ui --no-default-features --features southbag-inject-only
cargo test --locked -p espanso-ui --no-default-features
cargo test --locked -p espanso --no-default-features --features vendored-tls,wayland,espanso-clipboard/disabled
echo 'Source preparation unit tests passed; no worker or runtime artifact qualified'
