#!/usr/bin/env bash
# Packages the lock screen client as a versioned .deb, reproducing exactly
# what image hook 0016-lockd-build.hook.chroot compiles in the chroot:
# southbag-lockd and southbag-face-capture from the sources in
# image/config/includes.chroot/opt/southbag-lockd-src/, plus the helper
# scripts from includes.chroot/usr/local/bin/.
#
#   build-lockd-deb.sh <version> <out-dir>
#
# If the lockd sources are not in this tree (the lock work lands on its own
# branch), the script says so and exits 0 with no package - like the empty
# browser pin, the repo simply carries no lockd package yet. Needs gcc,
# pkg-config, wayland-scanner and the -dev packages the hook lists; the
# caller (CI) installs them.
set -euo pipefail

version="${1:?usage: build-lockd-deb.sh <version> <out-dir>}"
outdir="${2:?}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo/image/config/includes.chroot/opt/southbag-lockd-src"
bin="$repo/image/config/includes.chroot/usr/local/bin"

if [[ ! -f "$src/southbag-lockd.c" ]]; then
  echo "No lockd sources in this tree; repo carries no southbag-lockd package."
  exit 0
fi
for t in gcc pkg-config wayland-scanner; do
  command -v "$t" >/dev/null || { echo "Missing $t. Install: build-essential pkg-config libwayland-dev wayland-protocols libcairo2-dev libxkbcommon-dev libjpeg62-turbo-dev" >&2; exit 1; }
done

build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

# Same codegen and flags as the image hook - keep both in sync.
wayland-scanner client-header \
  /usr/share/wayland-protocols/staging/ext-session-lock/ext-session-lock-v1.xml \
  "$build/ext-session-lock-v1.h"
wayland-scanner private-code \
  /usr/share/wayland-protocols/staging/ext-session-lock/ext-session-lock-v1.xml \
  "$build/ext-session-lock-v1.c"

root="$build/root"
install -d "$root/DEBIAN" "$root/usr/local/bin"
gcc -O2 -Wall -Wextra -I"$build" -o "$root/usr/local/bin/southbag-lockd" \
  "$src/southbag-lockd.c" "$build/ext-session-lock-v1.c" \
  $(pkg-config --cflags --libs wayland-client cairo xkbcommon)
gcc -O2 -Wall -Wextra -o "$root/usr/local/bin/southbag-face-capture" \
  "$src/southbag-face-capture.c" -ljpeg
for helper in southbag-lock southbag-unlock southbag-face-unlock; do
  [[ -f "$bin/$helper" ]] && install -m 755 "$bin/$helper" "$root/usr/local/bin/$helper"
done
# swaylock config and its PAM entry ship with the lock feature (the image
# keeps swaylock as the fallback client).
for cfg in etc/swaylock/config etc/pam.d/swaylock; do
  [[ -f "$repo/image/config/includes.chroot/$cfg" ]] && install -D -m 644 "$repo/image/config/includes.chroot/$cfg" "$root/$cfg"
done
chmod 755 "$root/usr/local/bin/"*

cat > "$root/DEBIAN/control" <<CTRL
Package: southbag-lockd
Version: $version
Architecture: amd64
Maintainer: Southbag <os-updates@southbag.cc>
Depends: libwayland-client0, libcairo2, libxkbcommon0, libjpeg62-turbo, swaylock
Section: misc
Priority: optional
Description: Southbag OS session lock
 The ext-session-lock client and its helpers. While it holds the lock the
 compositor hides every window; helper failure leaves the session locked.
CTRL

cat > "$root/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
touch /run/reboot-required
POST
chmod 755 "$root/DEBIAN/postinst"

mkdir -p "$outdir"
deb="$outdir/southbag-lockd_${version}_amd64.deb"
dpkg-deb --root-owner-group --build "$root" "$deb"
echo "$deb"
