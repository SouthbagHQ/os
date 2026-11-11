"""Fakes for hardware-free fail-closed tests.

FakeIO models sysfs + device nodes. Device opens are backed by REAL
pipes so file descriptors are genuine, inheritable across a real fork,
and carry real O_NONBLOCK/CLOEXEC flag state; fstat/ioctl results are
scripted. FakeSocket scripts netlink datagrams (including MSG_TRUNC and
ENOBUFS). FakeFileStore scripts manifest ownership/mode so root-only
checks run without root.
"""

import errno
import os
import posixpath
import socket
import struct
import stat as statmod
from collections import namedtuple

from southbag_launcher import evdev
from southbag_launcher.errors import Deny
from southbag_launcher.manifest import enforce_rootonly_stat
from southbag_launcher.sysfsio import DeviceIO

Stat = namedtuple("Stat", ["st_mode", "st_rdev", "st_uid"])


def keyboard_bits():
    ev = bytearray(8)
    ev = evdev.set_bit(ev, evdev.EV_SYN)
    ev = evdev.set_bit(ev, evdev.EV_KEY)
    key = bytearray(evdev.KEY_BITMAP_BYTES)
    for bit in (evdev.KEY_ENTER, evdev.KEY_A, evdev.KEY_Z, evdev.KEY_SPACE,
                2, 3, 4, 5):  # KEY_1..KEY_4 for realism
        key = evdev.set_bit(key, bit)
    return bytes(ev), bytes(key)


def nonkeyboard_bits():
    ev = bytearray(8)
    ev = evdev.set_bit(ev, evdev.EV_SYN)
    ev = evdev.set_bit(ev, evdev.EV_KEY)
    key = bytearray(evdev.KEY_BITMAP_BYTES)
    key = evdev.set_bit(key, 116)  # KEY_POWER only
    return bytes(ev), bytes(key)


class FakeDevice:
    def __init__(self, event_name, name, dev, realpath, ev_bits, key_bits,
                 input_id=None, driver_ancestors=(), subsystem_ancestors=(),
                 phys="", uniq=""):
        self.event_name = event_name
        self.name = name
        self.dev = dev
        self.realpath = realpath
        self.ev_bits = ev_bits
        self.key_bits = key_bits
        self.input_id = input_id or {
            "bustype": "0x0011", "vendor": "0x0001",
            "product": "0x0001", "version": "0x0000",
        }
        self.driver_ancestors = tuple(driver_ancestors)
        self.subsystem_ancestors = tuple(subsystem_ancestors)
        self.phys = phys
        self.uniq = uniq
        self.present = True


class FakeIO(DeviceIO):
    def __init__(self, sysfs_root="/sys", dev_root="/dev"):
        super().__init__(sysfs_root, dev_root)
        self.devices = {}
        self.rp = {}
        self.node_symlinks = {}
        self.extra_files = {}
        self.uinput_present = True
        self.uinput_path = "/dev/uinput"
        self.fail_ioctl = set()
        self.fail_open = set()
        self.fd_map = {}
        self._pipe_write_ends = {}
        self.open_count = 0
        self.after_open_hook = None

    # -- construction helpers -------------------------------------------

    def add_keyboard(self, event_name="event3", name="Fake Serio Keyboard",
                     dev="13:67", virtual=False, bus_bound=True, bits=None,
                     phys="", uniq=""):
        if virtual:
            # Real uinput layout: /devices/virtual/input/inputN holds name
            # and phys DIRECTLY; eventM sits below it with a device
            # symlink resolving to inputN.
            realpath = ("%s/devices/virtual/input/input%s/%s"
                        % (self.sysfs_root, event_name[len("event"):],
                           event_name))
            driver_ancestors = ()
        elif bus_bound:
            parent = ("%s/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0"
                      % self.sysfs_root)
            realpath = "%s/0003:046d:c31c.0001/input/input_%s/%s" % (
                parent, event_name, event_name)
            driver_ancestors = (
                "%s/0003:046d:c31c.0001" % parent,
                parent,
                "%s/devices/pci0000:00/0000:00:14.0" % self.sysfs_root,
            )
        else:
            # Ambiguous: own platform subtree with no bus-bound ancestor.
            realpath = "%s/devices/platform/%s/input/input_%s/%s" % (
                self.sysfs_root, event_name, event_name, event_name)
            driver_ancestors = ()
        ev_bits, key_bits = bits if bits else keyboard_bits()
        d = FakeDevice(event_name, name, dev, realpath, ev_bits, key_bits,
                       driver_ancestors=driver_ancestors,
                       subsystem_ancestors=driver_ancestors,
                       phys=phys, uniq=uniq)
        self.devices[event_name] = d
        self.rp["%s/class/input/%s" % (self.sysfs_root, event_name)] = realpath
        return d

    def remove_device(self, event_name):
        self.devices[event_name].present = False

    def swap_node_symlink(self, event_name, target):
        self.node_symlinks["%s/input/%s" % (self.dev_root, event_name)] = target

    # -- DeviceIO surface -------------------------------------------------

    def realpath(self, path):
        if path in self.rp:
            return self.rp[path]
        if path.endswith("/device"):
            return posixpath.dirname(self.realpath(path[:-len("/device")]))
        return path

    def _known_files(self):
        known = {}
        for d in self.devices.values():
            if not d.present:
                continue
            device_dir = posixpath.dirname(d.realpath)
            known[d.realpath + "/dev"] = d.dev
            known[device_dir + "/name"] = d.name
            known[device_dir + "/phys"] = d.phys
            known[device_dir + "/uniq"] = d.uniq
        known.update(self.extra_files)
        return known

    def exists(self, path):
        if path in self.rp:
            return self.exists(self.rp[path])
        if path in self._known_files():
            return True
        for d in self.devices.values():
            if not d.present:
                continue
            if path == d.realpath:
                return True
            for a in d.driver_ancestors:
                if path == a + "/driver" or path == a + "/subsystem":
                    return True
            for a in d.subsystem_ancestors:
                if path == a + "/subsystem":
                    return True
        if path in ("%s/class/input" % self.sysfs_root,
                    "%s/devices" % self.sysfs_root):
            return True
        return False

    def read_text(self, path):
        known = self._known_files()
        if path in self.rp:
            return self.read_text(self.rp[path])
        if path in known:
            return known[path]
        raise OSError(errno.ENOENT, path)

    def listdir(self, path):
        if path == "%s/class/input" % self.sysfs_root:
            return sorted(e for e, d in self.devices.items() if d.present)
        raise OSError(errno.ENOENT, path)

    def open(self, path, flags):
        self.open_count += 1
        if self.after_open_hook:
            self.after_open_hook(self.open_count, path)
        if path in self.node_symlinks:
            if flags & os.O_NOFOLLOW:
                raise OSError(errno.ELOOP, "symlink", path)
            path = self.node_symlinks[path]
        if path in self.fail_open:
            raise OSError(errno.ENOENT, "gone", path)
        kind = None
        device = None
        if path == self.uinput_path:
            if not self.uinput_present:
                raise OSError(errno.ENOENT, path)
            kind = "uinput"
        elif path.startswith(self.dev_root + "/input/"):
            event_name = posixpath.basename(path)
            device = self.devices.get(event_name)
            if device is None or not device.present:
                raise OSError(errno.ENOENT, path)
            kind = "device"
        else:
            raise OSError(errno.ENOENT, path)
        # Real pipe so the fd is genuine: inheritable, real F_GETFL flags.
        r, w = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
        self._pipe_write_ends[r] = w
        self.fd_map[r] = (kind, device, flags)
        return r

    def close(self, fd):
        self.fd_map.pop(fd, None)
        w = self._pipe_write_ends.pop(fd, None)
        for f in {fd, w}:
            if f is not None:
                try:
                    os.close(f)
                except OSError:
                    pass

    def fstat(self, fd):
        kind, device, _flags = self.fd_map[fd]
        if kind == "uinput":
            return Stat(statmod.S_IFCHR | 0o600,
                        os.makedev(evdev.MISC_MAJOR, evdev.UINPUT_MINOR), 0)
        major, minor = (int(x) for x in device.dev.split(":"))
        return Stat(statmod.S_IFCHR | 0o600, os.makedev(major, minor), 0)

    def fd_status_flags(self, fd):
        return self.fd_map[fd][2]

    def ioctl_bytes(self, fd, request, length):
        kind, device, _flags = self.fd_map[fd]
        if kind == "uinput":
            raise OSError(errno.ENOTTY, "uinput has no evdev identity")
        if device.event_name in self.fail_ioctl:
            raise OSError(errno.ENOTTY, "scripted ioctl failure")
        if request == evdev.EVIOCGNAME(length):
            raw = device.name.encode() + b"\x00"
            return raw.ljust(length, b"\x00")[:length]
        if request == evdev.EVIOCGBIT(evdev.EV_SYN, 8):
            return device.ev_bits[:length].ljust(length, b"\x00")
        if request == evdev.EVIOCGBIT(evdev.EV_KEY, evdev.KEY_BITMAP_BYTES):
            return device.key_bits[:length].ljust(length, b"\x00")
        if request == evdev.EVIOCGID:
            vals = [int(device.input_id[k], 16)
                    for k in ("bustype", "vendor", "product", "version")]
            return struct.pack("HHHH", *vals)
        raise OSError(errno.ENOTTY, "unknown request 0x%x" % request)


class FakeSocket:
    """Scripts recvmsg over a real pipe so selectors block/wake for real.

    Models netlink multicast subscription: items carry (payload,
    sender_pid, group); only items whose group is subscribed are ever
    delivered (kernel-side filtering), and recvmsg returns the sender
    address like a real netlink socket: addr=(pid, groups).
    """

    def __init__(self, queue=(), groups=1):
        self.queue = list(queue)
        self.groups = groups
        self._r, self._w = os.pipe2(os.O_CLOEXEC)
        self.closed = False

    def push(self, item, sender_pid=0, group=1):
        """item: bytes | ("trunc", bytes) | ("error", errno)."""
        self.queue.append((item, sender_pid, group))
        os.write(self._w, b"x")

    def recvmsg(self, bufsize):
        while True:
            if not self.queue:
                raise BlockingIOError(errno.EAGAIN, "no datagrams")
            item, sender_pid, group = self.queue.pop(0)
            if not group & self.groups:
                continue  # not subscribed: kernel never delivers it
            addr = (sender_pid, group)
            if isinstance(item, tuple) and item[0] == "error":
                raise OSError(item[1], os.strerror(item[1]))
            if isinstance(item, tuple) and item[0] == "trunc":
                return item[1][:bufsize], [], socket.MSG_TRUNC, addr
            return item, [], 0, addr

    def fileno(self):
        return self._r

    def close(self):
        if not self.closed:
            self.closed = True
            for fd in (self._r, self._w):
                try:
                    os.close(fd)
                except OSError:
                    pass


def make_uevent(action, devpath, subsystem="input", devname="", seqnum=1):
    fields = [
        "%s@%s" % (action, devpath),
        "ACTION=%s" % action,
        "DEVPATH=%s" % devpath,
        "SUBSYSTEM=%s" % subsystem,
        "SEQNUM=%d" % seqnum,
    ]
    if devname:
        fields.append("DEVNAME=%s" % devname)
    return b"\x00".join(f.encode() for f in fields) + b"\x00"


class FakeFileStore:
    """Scripts manifest ownership/mode without needing root."""

    def __init__(self, content=None, uid=0, mode=0o400, symlink=False,
                 regular=True):
        self.content = content
        self.uid = uid
        self.mode = mode
        self.symlink = symlink
        self.regular = regular
        self.written = {}

    def read_rootonly(self, path):
        if self.symlink:
            raise Deny("manifest open failed (%s): too many levels of "
                       "symbolic links" % path)
        if self.content is None:
            raise Deny("manifest open failed (%s): no such file" % path)
        mode = (statmod.S_IFREG if self.regular else statmod.S_IFDIR) | self.mode
        enforce_rootonly_stat(path, Stat(mode, 0, self.uid))
        return self.content

    def write_atomic_rootonly(self, path, data):
        self.written[path] = data


class FakeClock:
    def __init__(self, start=1000.0):
        self.now = start

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
