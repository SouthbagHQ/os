#!/usr/bin/env bash
# Stage only the exact separately qualified CI payload. No activation on host.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deb=${1:?}; source=${2:?}
[[ $(sha256sum "$deb" | cut -d' ' -f1) = bdea3447ab3d0b69157cdf33d2ba8e014971973c114634a5ebf6803261071951 ]] || { echo 'Unrecognized Kevin package' >&2; exit 1; }
[[ $(sha256sum "$source" | cut -d' ' -f1) = 9d00e6cd1b2917c63022664426c8f25e174644711882c1671894a60bb5e4d0d9 ]] || { echo 'Corresponding source mismatch' >&2; exit 1; }
mkdir -p "$repo/image/config/includes.chroot/tmp" "$repo/out"
install -m644 "$deb" "$repo/image/config/includes.chroot/tmp/southbag-kevin-candidate.deb"
install -m644 "$source" "$repo/out/southbag-inject_2.4.1+southbag.2.kevin1.ci2_source.tar.gz"
echo 'Staged exact input. Root boot hook activates only inside the image.'
