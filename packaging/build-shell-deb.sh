#!/usr/bin/env bash
# Packages the shell as a versioned .deb so installed devices can upgrade it
# through the Southbag apt repo instead of waiting for a re-flash.
#
#   build-shell-deb.sh <version> <dist-device-dir> <out-dir>
#
# <dist-device-dir> is the output of `bun run build:device`; the hand-written
# CGI helpers in image/shell-extra are layered on top, exactly as image
# builds do in image/build.sh.
set -euo pipefail

version="${1:?usage: build-shell-deb.sh <version> <dist-device-dir> <out-dir>}"
dist="${2:?}"
outdir="${3:?}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f "$dist/index.html" ]] || { echo "No built shell at $dist - run 'bun run build:device' first." >&2; exit 1; }

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
install -d "$root/DEBIAN" "$root/usr/share/southbag-shell"
cp -R "$dist/." "$root/usr/share/southbag-shell/"
cp -R "$repo/image/shell-extra/." "$root/usr/share/southbag-shell/"
chmod +x "$root/usr/share/southbag-shell/cgi-bin/"*
find "$root/usr/share/southbag-shell" -type d -exec chmod 755 {} +

# The shell's runtime helpers must update with its web bundle. Lock helpers
# and broker files are owned by southbag-lockd, never by both packages.
for name in southbag-account-status southbag-browser-session southbag-session southbag-device-session southbag-shell southbag-ready southbag-nav-state southbag-analytics southbag-brightness-max; do
  install -D -m 755 "$repo/image/config/includes.chroot/usr/local/bin/$name" "$root/usr/local/bin/$name"
done
for path in etc/labwc/rc.xml etc/systemd/system/southbag-ready.service; do
  install -D -m 644 "$repo/image/config/includes.chroot/$path" "$root/$path"
done
if [[ -s "$repo/image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg" ]]; then
  install -D -m 644 "$repo/image/config/includes.chroot/usr/share/keyrings/southbag-archive-keyring.gpg" "$root/usr/share/keyrings/southbag-archive-keyring.gpg"
fi

cat > "$root/DEBIAN/control" <<CTRL
Package: southbag-shell
Version: $version
Architecture: all
Maintainer: Southbag <os-updates@southbag.cc>
Depends: busybox, systemd, python3, jq, alsa-utils
Breaks: southbag-browser (<< 1.1.1)
Section: misc
Priority: optional
Description: Southbag OS shell
 The desktop the customer sees, served over loopback by
 /usr/local/bin/southbag-shell. Versioned so Kevin can correct Himself
 everywhere without a re-flash.
CTRL

# The running session keeps serving the files it already loaded; a reboot
# starts the new shell cleanly. Flag it and let the unattended-upgrades
# reboot window (03:30 by default) pick the moment.
cat > "$root/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
fi
touch /run/reboot-required
POST
chmod 755 "$root/DEBIAN/postinst"

mkdir -p "$outdir"
deb="$outdir/southbag-shell_${version}_all.deb"
dpkg-deb --root-owner-group --build "$root" "$deb"
echo "$deb"
