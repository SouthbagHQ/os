"""Minimal evdev/uinput ioctl surface. No third-party dependencies.

Constants mirror <linux/input.h> and <linux/uinput.h>. All functions are
pure computation; actual ioctl plumbing lives in sysfsio.DeviceIO so
tests can substitute a fake.
"""

import hashlib
import struct

INPUT_MAJOR = 13
MISC_MAJOR = 10
UINPUT_MINOR = 223

_EV_TYPE = ord("E")
_IOC_READ = 2


def _ioc(direction, type_, nr, size):
    return (direction << 30) | (type_ << 8) | nr | (size << 16)


def EVIOCGBIT(ev, length):
    """Request code for reading the capability bitmask of event type ev."""
    return _ioc(_IOC_READ, _EV_TYPE, 0x20 + ev, length)


def EVIOCGNAME(length):
    return _ioc(_IOC_READ, _EV_TYPE, 0x06, length)


# struct input_id { __u16 bustype, vendor, product, version; }
EVIOCGID = _ioc(_IOC_READ, _EV_TYPE, 0x02, 8)


EV_SYN = 0x00
EV_KEY = 0x01

KEY_ENTER = 28
KEY_A = 30
KEY_Z = 44
KEY_SPACE = 57

# Key bits that must all be present for a device to qualify as a
# keyboard for our purposes. Chosen to exclude power buttons, mice with
# a couple of "keyboard" keys, and consumer-control devices.
REQUIRED_KEY_BITS = (KEY_ENTER, KEY_A, KEY_Z, KEY_SPACE)

KEY_BITMAP_BYTES = 96  # covers KEY_MAX (0x2ff) comfortably


def test_bit(buf, bit):
    return bool(buf[bit // 8] & (1 << (bit % 8)))


def set_bit(buf, bit):
    """Test helper: return a new bytearray with bit set."""
    out = bytearray(buf)
    out[bit // 8] |= 1 << (bit % 8)
    return out


def looks_like_keyboard(ev_bits, key_bits):
    """Capability check: EV_KEY advertised plus a real alpha/enter/space set.

    This is the evdev half of identity; sysfs physical ancestry is the
    other half. Neither alone is sufficient.
    """
    if not ev_bits or not test_bit(ev_bits, EV_KEY):
        return False
    if not key_bits:
        return False
    return all(test_bit(key_bits, k) for k in REQUIRED_KEY_BITS)


def capability_digest(ev_bits, key_bits):
    """Stable digest binding the recorded capability set into the manifest.

    A device whose capabilities change underneath us fails validation,
    even when its name and node are unchanged.
    """
    h = hashlib.sha256()
    h.update(b"ev:")
    h.update(bytes(ev_bits))
    h.update(b"\nkey:")
    h.update(bytes(key_bits))
    return "sha256:" + h.hexdigest()


def parse_input_id(buf):
    """Parse struct input_id into a manifest-friendly dict of hex strings."""
    bustype, vendor, product, version = struct.unpack("HHHH", bytes(buf[:8]))
    return {
        "bustype": "0x%04x" % bustype,
        "vendor": "0x%04x" % vendor,
        "product": "0x%04x" % product,
        "version": "0x%04x" % version,
    }


def is_char_device_with_rdev(st_mode, st_rdev, expect_major, expect_minor=None):
    import os
    import stat as statmod

    if not statmod.S_ISCHR(st_mode):
        return False
    if os.major(st_rdev) != expect_major:
        return False
    if expect_minor is not None and os.minor(st_rdev) != expect_minor:
        return False
    return True
