#!/usr/bin/env bash
# Build a dormant package from the exact local reviewed artifact. This does
# not download, execute, install, enable or activate the worker.
# Usage: build-inject-deb.sh BINARY SOURCE_TAR OUTDIR
set -euo pipefail
binary=${1:?}; source=${2:?}; out=${3:?}
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
expected=96da5411cc1b20a3b46fe7de277aa3b047d182694b006720f358a341db11aeef
[[ $(sha256sum "$binary" | cut -d' ' -f1) = "$expected" ]] || { echo 'Unrecognized worker artifact' >&2; exit 1; }
# Source contents must not include local build logs/credentials or private
# provenance. This pinned archive is generated from the tracked product files.
[[ $(sha256sum "$source" | cut -d' ' -f1) = 28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be ]] || { echo 'Unrecognized source archive' >&2; exit 1; }
root=$(mktemp -d); trap 'rm -rf "$root"' EXIT
install -d "$root/DEBIAN" "$root/opt/southbag/bin" "$root/etc/systemd/system" "$root/usr/share/doc/southbag-inject"
install -m 755 "$binary" "$root/opt/southbag/bin/espanso"
# Corresponding source accompanies the .deb as a separate artifact, not
# 70 MB of build/vendor files in the runtime image.
tar -xOf "$source" LICENSE >"$root/usr/share/doc/southbag-inject/copyright"
install -m 644 "$repo/image/config/includes.chroot/etc/systemd/system/southbag-espanso.service" "$root/etc/systemd/system/"
install -d "$root/etc/southbag"
cp -R "$repo/image/config/includes.chroot/etc/southbag/espanso" "$root/etc/southbag/"
install -d -m 755 "$root/etc/southbag/espanso/packages"
find "$root/etc/southbag" -type d -exec chmod 755 {} +
find "$root/etc/southbag" -type f -exec chmod 644 {} +
cp "$repo/packaging/inject-provenance.txt" "$root/usr/share/doc/southbag-inject/"
cat > "$root/DEBIAN/control" <<'CTRL'
Package: southbag-inject
Version: 2.4.1+southbag.1.minimal
Architecture: amd64
Maintainer: Southbag Agent <agent@southbag.cc>
Depends: adduser, systemd, libc6 (>= 2.39), libgcc-s1, libbz2-1.0, libxkbcommon0
Section: utils
Priority: optional
Description: Dormant Southbag dedicated inject-only worker candidate
 Hard activation denial remains in place. No input device access is granted.
 Not enabled at boot, no automatic restart, no keyboard reader started.
CTRL
# Reuse the same identity contract in both package and image.
cp "$repo/image/config/hooks/normal/0012-inject-user.hook.chroot" "$root/DEBIAN/postinst"
# dpkg runs preinst before unpack: reject unsafe pre-existing identities before
# copying a binary/unit. Missing identity is created only at configure time.
cp "$repo/image/config/hooks/normal/0012-inject-user.hook.chroot" "$root/DEBIAN/preinst"
chmod 755 "$root/DEBIAN/postinst" "$root/DEBIAN/preinst"
mkdir -p "$out"
install -m 644 "$source" "$out/southbag-inject_2.4.1+southbag.1.minimal_source.tar.gz"
dpkg-deb --root-owner-group --build "$root" "$out/southbag-inject_2.4.1+southbag.1.minimal_amd64.deb"
