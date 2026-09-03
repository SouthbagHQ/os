#!/usr/bin/env bash
# Builds the Southbag OS ISO.
#
# live-build needs a Debian host with loop devices and root, so this runs in a
# privileged Debian container. It works the same on a Linux workstation and on
# a CI runner; it cannot run on macOS.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"

if [[ ! -d "$repo/dist-device" ]]; then
  echo "No dist-device/. Run 'bun run build:device' first." >&2
  exit 1
fi

# The shell is ordinary files on disk, served over loopback at boot. This
# directory is generated, so anything hand-written that belongs beside the
# bundle — the launcher CGI — is kept in shell-extra and copied in after.
served="$here/config/includes.chroot/usr/share/southbag-shell"
rm -rf "$served"
mkdir -p "$served"
cp -R "$repo/dist-device/." "$served/"
cp -R "$here/shell-extra/." "$served/"
chmod +x "$served/cgi-bin/launch"

docker run --rm --privileged \
  -v "$here:/image" -w /image \
  debian:trixie /bin/bash -euo pipefail -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends live-build xorriso

    # UEFI only. grub-efi rather than systemd-boot: a hybrid live ISO is not
    # the A/B verity layout systemd-boot was chosen for, and grub-efi is what
    # live-build can actually produce here.
    #
    # --debian-installer live, not true: the installer copies the live
    # filesystem onto the disk, so what gets installed is this image rather
    # than a stock Debian reassembled from packages. Text installer; the
    # graphical one is weight for a step taken once.
    lb config \
      --distribution trixie \
      --architecture amd64 \
      --archive-areas main \
      --binary-images iso-hybrid \
      --bootloaders grub-efi \
      --memtest none \
      --debian-installer live \
      --debian-installer-gui false \
      --apt-recommends false \
      --apt-indices false \
      --firmware-chroot false \
      --bootappend-live "boot=live live-config.hostname=southbag console=tty0 console=ttyS0,115200n8" \
      --iso-application "Southbag OS" \
      --iso-publisher "Southbag" \
      --iso-volume "Southbag OS"

    lb build
  '

# live-build names the output after the image type.
iso="$(find "$here" -maxdepth 1 -name "live-image-amd64.hybrid.iso" -print -quit)"
if [[ -z "$iso" ]]; then
  echo "Build produced no ISO." >&2
  exit 1
fi
mkdir -p "$repo/out"
mv "$iso" "$repo/out/southbag-os.iso"
ls -lh "$repo/out/southbag-os.iso"
