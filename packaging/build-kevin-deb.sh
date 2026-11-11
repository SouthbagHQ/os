#!/usr/bin/env bash
# Build the reviewed normal-image candidate. Never executes or enables it.
# Final image qualification and staging pin are independent gates.
set -euo pipefail
binary=${1:?}; source=${2:?}; out=${3:?}; lane=${4:-local-v5}
case "$lane" in
 local-v5) binary_hash=47045bd3cfd631ee0f33a362e74676e1ae813f329937390d23cc684b84c0ffcf; version=2.4.1+southbag.2.kevin1 ;;
 ci1) binary_hash=c28046a7573efedc8806e8ea70c60be8df3c4ff52101aa6264f929b4fc046f1d; version=2.4.1+southbag.2.kevin1.ci1 ;;
 *) echo "Unknown candidate lane" >&2; exit 1 ;;
esac
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ $(sha256sum "$binary" | cut -d' ' -f1) = "$binary_hash" ]] || { echo 'worker mismatch' >&2; exit 1; }
[[ $(sha256sum "$source" | cut -d' ' -f1) = 9d00e6cd1b2917c63022664426c8f25e174644711882c1671894a60bb5e4d0d9 ]] || { echo 'source mismatch' >&2; exit 1; }
root=$(mktemp -d); trap 'rm -rf "$root"' EXIT
install -d "$root/DEBIAN" "$root/opt/southbag/bin" "$root/etc/southbag/espanso/config" "$root/etc/southbag/espanso/match" "$root/etc/southbag/espanso/packages" "$root/etc/systemd/system" "$root/usr/share/doc/southbag-inject" "$root/usr/lib/southbag-launcher/southbag_launcher" "$root/usr/libexec"
install -m755 "$binary" "$root/opt/southbag/bin/espanso"
for unit in southbag-espanso.service southbag-espanso-setup.service southbag-espanso-boot.service; do
 install -m644 "$repo/image/config/includes.chroot/etc/systemd/system/$unit" "$root/etc/systemd/system/"
done
install -m755 "$repo/image/config/includes.chroot/usr/libexec/southbag-launcher" "$root/usr/libexec/"
install -m644 "$repo/image/config/includes.chroot/usr/lib/southbag-launcher/southbag_launcher/"*.py "$root/usr/lib/southbag-launcher/southbag_launcher/"
cat > "$root/etc/southbag/espanso/config/default.yml" <<'CONFIG'
backend: Inject
auto_restart: false
show_notifications: false
show_icon: false
keyboard_layout:
  layout: us
CONFIG
cat > "$root/etc/southbag/espanso/match/base.yml" <<'MATCH'
matches:
  - trigger: kevin
    replace: Kevin
    force_mode: keys
MATCH
printf 'kevin=all-fields\n' > "$root/etc/southbag/kevin-all-fields"
tar -xOf "$source" LICENSE > "$root/usr/share/doc/southbag-inject/copyright"
install -m644 "$repo/docs/kevin-runtime.md" "$root/usr/share/doc/southbag-inject/"
cat > "$root/DEBIAN/control" <<CTRL
Package: southbag-inject
Version: $version
Architecture: amd64
Maintainer: Southbag <os-updates@southbag.cc>
Depends: adduser, systemd, python3, kmod, libc6 (>= 2.39), libgcc-s1, libbz2-1.0, libxkbcommon0
Section: utils
Priority: optional
Description: Southbag all-fields Kevin enforcement worker
 Dedicated unprivileged worker with root-opened physical-keyboard grants.
 Starts once per boot only. Sign-out or topology loss stops until reboot.
CTRL
# The image hook creates the identity before package configuration. Upgrades
# reject unsafe pre-existing identities through the same checked contract.
cp "$repo/image/config/hooks/normal/0012-inject-user.hook.chroot" "$root/DEBIAN/postinst"
cp "$repo/image/config/hooks/normal/0012-inject-user.hook.chroot" "$root/DEBIAN/preinst"
chmod 755 "$root/DEBIAN/postinst" "$root/DEBIAN/preinst"
mkdir -p "$out"
install -m644 "$source" "$out/southbag-inject_${version}_source.tar.gz"
find "$root" -print0 | xargs -0 touch -h -d @1794350000
SOURCE_DATE_EPOCH=1794350000 dpkg-deb -Zgzip -z9 --uniform-compression --root-owner-group --build "$root" "$out/southbag-inject_${version}_amd64.deb"
