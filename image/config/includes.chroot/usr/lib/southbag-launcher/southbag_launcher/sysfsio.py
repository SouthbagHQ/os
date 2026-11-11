"""OS-interaction seam for sysfs and device nodes.

DeviceIO is the only place the launcher touches the operating system for
device facts. Tests substitute FakeIO (tests/fakes.py) so every
fail-closed path is provable without hardware.

The real implementation deliberately keeps the surface small:
realpath/read/listdir/exists for sysfs, open/fstat/ioctl for nodes.
"""

import fcntl
import os
import posixpath

from . import evdev
from .errors import Deny


class DeviceIO:
    """Real-OS implementation. sysfs_root/dev_root are injectable so the
    same code can be pointed at a fixture tree on a developer machine."""

    def __init__(self, sysfs_root="/sys", dev_root="/dev"):
        self.sysfs_root = sysfs_root.rstrip("/")
        self.dev_root = dev_root.rstrip("/")

    # -- sysfs ---------------------------------------------------------
    def realpath(self, path):
        return os.path.realpath(path)

    def read_text(self, path):
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip()

    def exists(self, path):
        return os.path.exists(path)

    def listdir(self, path):
        return sorted(os.listdir(path))

    # -- nodes ---------------------------------------------------------
    def open(self, path, flags):
        return os.open(path, flags)

    def close(self, fd):
        os.close(fd)

    def fstat(self, fd):
        return os.fstat(fd)

    def ioctl_bytes(self, fd, request, length):
        """Issue an ioctl that fills a buffer; returns raw bytes."""
        buf = bytearray(length)
        fcntl.ioctl(fd, request, buf, True)
        return bytes(buf)

    # -- derived helpers ----------------------------------------------
    def ioctl_name(self, fd):
        raw = self.ioctl_bytes(fd, evdev.EVIOCGNAME(256), 256)
        return raw.split(b"\x00", 1)[0].decode("utf-8", "replace")

    def ioctl_ev_bits(self, fd):
        return self.ioctl_bytes(fd, evdev.EVIOCGBIT(evdev.EV_SYN, 8), 8)

    def ioctl_key_bits(self, fd):
        return self.ioctl_bytes(
            fd, evdev.EVIOCGBIT(evdev.EV_KEY, evdev.KEY_BITMAP_BYTES),
            evdev.KEY_BITMAP_BYTES,
        )

    def ioctl_input_id(self, fd):
        return evdev.parse_input_id(self.ioctl_bytes(fd, evdev.EVIOCGID, 8))


def class_path(io, event_name):
    return "%s/class/input/%s" % (io.sysfs_root, event_name)


def event_node(io, event_name):
    return "%s/input/%s" % (io.dev_root, event_name)


def ancestry_chain(io, sysfs_realpath):
    """Walk innermost -> outermost up to (and excluding) <sysfs>/devices."""
    root = io.sysfs_root + "/devices"
    chain = []
    p = sysfs_realpath
    while p.startswith(root + "/"):
        chain.append(p)
        p = posixpath.dirname(p)
    return chain


def is_virtual_ancestry(io, sysfs_realpath):
    """Virtual subtree (uinput and friends) never qualifies as physical."""
    return sysfs_realpath.startswith(io.sysfs_root + "/devices/virtual/")


def physical_evidence(io, sysfs_realpath):
    """Physical ancestry half of identity.

    Returns (ok, reason). ok=True requires:
      * the realpath to live under <sysfs>/devices but NOT under
        <sysfs>/devices/virtual, and
      * at least one ancestor with a bound driver (a 'driver' symlink) or
        a bus attachment (a 'subsystem' symlink) above the input core
        directories - i.e. a real bus, not the virtual root.

    Missing or ambiguous state returns ok=False; callers deny.
    """
    if not io.exists(sysfs_realpath):
        return False, "sysfs path missing"
    if is_virtual_ancestry(io, sysfs_realpath):
        return False, "virtual ancestry"
    chain = ancestry_chain(io, sysfs_realpath)
    if not chain:
        return False, "no device ancestry"
    for ancestor in chain:
        base = posixpath.basename(ancestor)
        if base.startswith("event") or base.startswith("input"):
            # input-core directories themselves prove nothing.
            continue
        if io.exists(ancestor + "/driver") or io.exists(ancestor + "/subsystem"):
            return True, "bus-bound ancestor %s" % ancestor
    return False, "no bus-bound ancestor (ambiguous)"


def enumerate_event_names(io):
    cdir = io.sysfs_root + "/class/input"
    try:
        names = io.listdir(cdir)
    except OSError as exc:
        raise Deny("cannot list %s: %s" % (cdir, exc))
    return [n for n in names if n.startswith("event")]


def describe_event(io, event_name):
    """Collect the full identity of one candidate event node.

    Skip vs deny, per the design's "missing or ambiguous state denies
    startup":
      * EXPECTED SKIP (return None): virtual ancestry (uinput and
        friends), or capability-proven non-keyboard (e.g. a power
        button). Neither can be a keystroke source, so neither can
        shrink the approved set.
      * DENY (raise Deny): vanished sysfs entries, open/capability
        errors, and any KEYBOARD-CAPABLE device whose physical evidence
        is missing or ambiguous (no device ancestry, no bus-bound
        ancestor). Silently ignoring one of those can start the unit
        with an incomplete keyboard set.
    """
    cpath = class_path(io, event_name)
    if not io.exists(cpath):
        raise Deny("sysfs entry vanished during discovery: %s" % event_name)
    realpath = io.realpath(cpath)
    if not io.exists(realpath):
        raise Deny("sysfs device vanished during discovery: %s" % event_name)
    if is_virtual_ancestry(io, realpath):
        return None  # expected skip: virtual

    node = event_node(io, event_name)
    try:
        fd = io.open(node, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError as exc:
        raise Deny("cannot open candidate %s during discovery: %s" % (node, exc))
    try:
        try:
            ev_bits = io.ioctl_ev_bits(fd)
            key_bits = io.ioctl_key_bits(fd)
        except OSError as exc:
            raise Deny("capability read failed for %s: %s" % (event_name, exc))
        if not evdev.looks_like_keyboard(ev_bits, key_bits):
            return None  # expected skip: capability-proven non-keyboard

        # Keyboard-capable: physical evidence must be present and
        # unambiguous, or the approved set may be incomplete.
        ok, reason = physical_evidence(io, realpath)
        if not ok:
            raise Deny("keyboard-capable device %s has missing or "
                       "ambiguous physical evidence: %s" % (event_name, reason))

        name = io.ioctl_name(fd)
        input_id = io.ioctl_input_id(fd)
        st = io.fstat(fd)
        if not evdev.is_char_device_with_rdev(
            st.st_mode, st.st_rdev, evdev.INPUT_MAJOR
        ):
            raise Deny("%s is not a char device with input major" % node)
        dev = "%d:%d" % (os.major(st.st_rdev), os.minor(st.st_rdev))
    finally:
        io.close(fd)

    # sysfs cross-check: the recorded dev number must match the opened node.
    sysfs_dev = io.read_text(realpath + "/dev")
    if sysfs_dev != dev:
        raise Deny(
            "sysfs/dev node mismatch for %s: sysfs=%s fstat=%s"
            % (event_name, sysfs_dev, dev)
        )

    device_realpath = io.realpath(cpath + "/device")
    phys = _read_optional(io, device_realpath + "/phys")
    uniq = _read_optional(io, device_realpath + "/uniq")

    return {
        "event_node": node,
        "event_name": event_name,
        "sysfs_realpath": realpath,
        "device_realpath": device_realpath,
        "dev": dev,
        "name": name,
        "phys": phys,
        "uniq": uniq,
        "input_id": input_id,
        "ev_bits_hex": ev_bits.hex(),
        "key_bits_hex": key_bits.hex(),
        "capability_digest": evdev.capability_digest(ev_bits, key_bits),
    }


def _read_optional(io, path):
    try:
        return io.read_text(path)
    except OSError:
        return ""
