#!/usr/bin/env bash
# Optional offline image input. No downloads, secret use, worker execution or
# activation. Only this guest-tested .deb is accepted, never a CI candidate.
# stage-inject-image.sh [EXACT_DEB EXACT_SOURCE_TAR]
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
staged="$repo/image/config/includes.chroot/tmp/southbag-inject-candidate.deb"
# A previous optional input must not leak into a later default image build.
rm -f "$staged"
if [[ $# = 0 ]]; then exit 0; fi
[[ $# = 2 ]] || { echo 'Both package and corresponding source are required' >&2; exit 1; }
deb=$1; source=$2
[[ $(sha256sum "$deb" | cut -d' ' -f1) = 57354fa506d2d1d5319bb43384049f32f20127d7cc2ecc6508442fe5a53a4d21 ]] || {
 echo 'Not the guest-tested dormant package' >&2; exit 1;
}
[[ $(sha256sum "$source" | cut -d' ' -f1) = 28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be ]] || {
 echo 'Corresponding source mismatch' >&2; exit 1;
}
mkdir -p "$(dirname "$staged")" "$repo/out"
install -m 644 "$source" "$repo/out/southbag-inject_2.4.1+southbag.1.minimal_source.tar.gz"
install -m 644 "$deb" "$staged"
echo 'Staged exact dormant package; image hook installs after customer creation. Activation remains denied.'
