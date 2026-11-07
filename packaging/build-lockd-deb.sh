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
# Customer stop-only broker transport and root lifecycle authority ship atomically
# with the lock helper that requires them. No input worker is installed/started.
install -d "$root/usr/local/sbin" "$root/etc/systemd/system"
gcc -O2 -Wall -Wextra -Werror -o "$root/usr/local/bin/southbag-input-client" \
 "$repo/image/config/includes.chroot/opt/southbag-broker-src/southbag-input-client.c"
install -m 755 "$repo/image/config/includes.chroot/usr/local/sbin/southbag-input-broker" "$root/usr/local/sbin/"
for unit in southbag-input-broker.service southbag-input-broker.socket southbag-input-broker@.service; do
 install -m 644 "$repo/image/config/includes.chroot/etc/systemd/system/$unit" "$root/etc/systemd/system/$unit"
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
Depends: libc6, systemd, libwayland-client0, libcairo2, libxkbcommon0, libjpeg62-turbo, swaylock
Section: misc
Priority: optional
Description: Southbag OS session lock
 The ext-session-lock client and its helpers. While it holds the lock the
 compositor hides every window; helper failure leaves the session locked.
CTRL

# Debian swaylock owns these paths. Use package-owned diversions rather than
# force-overwriting another package's files; removal restores the prior bytes.
cat > "$root/DEBIAN/preinst" <<'PRE'
#!/bin/sh
set -e
case "$1" in install|upgrade)
 for path in /etc/pam.d/swaylock /etc/swaylock/config; do
  owner=$(dpkg-divert --listpackage "$path")
  [ -z "$owner" ] || [ "$owner" = southbag-lockd ] || {
   echo "Conflicting diversion for $path" >&2; exit 1;
  }
  dpkg-divert --package southbag-lockd --add --rename --divert "$path.southbag-distrib" "$path"
 done
 ;; esac
PRE
cat > "$root/DEBIAN/prerm" <<'BEFORE_REMOVE'
#!/bin/sh
set -e
if [ "$1" = remove ] && command -v systemctl >/dev/null 2>&1; then
 systemctl stop southbag-input-broker.socket
 systemctl disable southbag-input-broker.socket southbag-input-broker.service
fi
BEFORE_REMOVE
cat > "$root/DEBIAN/postrm" <<'REMOVE'
#!/bin/sh
set -e
case "$1" in remove|purge|abort-install)
 for path in /etc/pam.d/swaylock /etc/swaylock/config; do
  if [ "$(dpkg-divert --listpackage "$path")" = southbag-lockd ]; then
   dpkg-divert --package southbag-lockd --remove --rename --divert "$path.southbag-distrib" "$path"
  fi
 done
 ;; esac
REMOVE
chmod 755 "$root/DEBIAN/preinst" "$root/DEBIAN/prerm" "$root/DEBIAN/postrm"

cat > "$root/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
# Enable only the inhibit-only broker and request socket for the NEXT boot.
# Never start them during a package update or activate an input worker.
if command -v systemctl >/dev/null 2>&1; then
 systemctl enable southbag-input-broker.service southbag-input-broker.socket
fi
touch /run/reboot-required
POST
chmod 755 "$root/DEBIAN/postinst"

mkdir -p "$outdir"
deb="$outdir/southbag-lockd_${version}_amd64.deb"
dpkg-deb --root-owner-group --build "$root" "$deb"
echo "$deb"
