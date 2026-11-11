"""Kernel input-topology monitor (broker side, contract section 4).

Established BEFORE the snapshot/open transaction: the constructor opens
and binds the netlink socket FIRST, then takes the baseline snapshot, so
there is no unmonitored window between snapshot and listening.

Sources of truth:

1. NETLINK_KOBJECT_UEVENT datagrams, checked for sequence gaps,
   truncation (MSG_TRUNC), overflow (ENOBUFS), malformed payloads, and
   read failures - every one is terminal.
2. Periodic rechecks of the physical snapshot against the baseline.

Classification is deliberately asymmetric (fail closed):

* add/remove/change touching an approved manifest device: terminal.
* any input event under /devices/virtual that is not PROVEN to be the
  exact worker-created uinput device: terminal ("no arbitrary virtual
  input is admitted"). Proof is the integrator-selected recognition
  transaction: sysfs name == SOUTHBAG_UINPUT_DEVICE_NAME AND sysfs phys
  == "southbag:<generation>" (the generation the root broker minted and
  scrubbed into the contract environment) AND the candidate is the
  single new sysfs path matching both - any preexisting match is denied
  at launch, and a second matching path is terminal. Name matching
  alone is never the exemption.
* the exact bound worker-created synthetic output device: ignored.
* bind/unbind on non-approved devices: ignored (routine driver
  reprobing); on approved devices: terminal.
* non-input subsystems: ignored.
* any other physical input add/remove/change: terminal.

On terminal classification the launcher signals the worker over
SOUTHBAG_MONITOR_FD (any readiness or hangup there means loss) and stops
the unit without restart.
"""

import errno
import socket

from . import SOUTHBAG_UINPUT_DEVICE_NAME
from .errors import MonitorTerminal
from . import manifest as manifest_mod

RECV_BUFSIZE = 8192

# Linux NETLINK_KOBJECT_UEVENT protocol number. The stdlib socket module
# does not expose this name on every Python build (absent on the
# integration target's Python), so bind the constant directly. Source:
# include/uapi/linux/netlink.h ("#define NETLINK_KOBJECT_UEVENT 15"),
# stable uapi since 2.6.
NETLINK_KOBJECT_UEVENT = 15

# Multicast groups for NETLINK_KOBJECT_UEVENT (lib/kobject_uevent.c and
# udev's monitor): group 1 is the kernel's raw kobject uevents; group 2
# carries udev's USERSPACE libudev envelope (different payload format,
# no "action@devpath" header). Binding the full 0xFFFFFFFF mask mixes in
# udev's envelope and trips strict malformed-message denial - observed
# on the first real dedicated-UID guest start. Subscribe group 1 only.
UEVENT_KERNEL_GROUP = 1

_TERMINAL_ACTIONS = frozenset(("add", "remove", "change"))
_REPROBE_ACTIONS = frozenset(("bind", "unbind"))


class Uevent:
    __slots__ = ("action", "devpath", "subsystem", "devname", "seqnum", "props")

    def __init__(self, action, devpath, subsystem, devname, seqnum, props):
        self.action = action
        self.devpath = devpath
        self.subsystem = subsystem
        self.devname = devname
        self.seqnum = seqnum
        self.props = props


def parse_uevent(data):
    """Parse one kobject-uevent datagram. Malformed input is terminal:
    a monitor that cannot trust its own stream must not stay silent."""
    try:
        parts = data.split(b"\x00")
        header = parts[0].decode("ascii", "strict")
        if "@" not in header:
            raise ValueError("no @ in header")
        action, devpath = header.split("@", 1)
        props = {}
        for field in parts[1:]:
            if not field:
                continue
            key, sep, value = field.partition(b"=")
            if not sep:
                raise ValueError("malformed property %r" % field)
            props[key.decode("ascii", "strict")] = value.decode("utf-8", "replace")
        seqnum = props.get("SEQNUM")
        if seqnum is None:
            raise ValueError("missing SEQNUM")
        return Uevent(
            action=action,
            devpath=devpath,
            subsystem=props.get("SUBSYSTEM", ""),
            devname=props.get("DEVNAME", ""),
            seqnum=int(seqnum),
            props=props,
        )
    except (ValueError, UnicodeDecodeError) as exc:
        raise MonitorTerminal("malformed uevent datagram: %s" % exc)


def make_netlink_socket():
    """Real kernel uevent socket. Uses the numeric uapi constant (15)
    because socket.NETLINK_KOBJECT_UEVENT is not exposed by every stdlib
    build; the number is stable uapi (include/uapi/linux/netlink.h).
    Binds multicast group 1 ONLY (kernel kobject uevents); udev's
    userspace group-2 envelope is not subscribed."""
    sock = socket.socket(
        socket.AF_NETLINK,
        socket.SOCK_DGRAM | socket.SOCK_NONBLOCK | socket.SOCK_CLOEXEC,
        NETLINK_KOBJECT_UEVENT,
    )
    sock.bind((0, UEVENT_KERNEL_GROUP))
    return sock


def _canonical_input_dir(devpath):
    """Map an input uevent devpath to its canonical inputN directory.

    /devices/virtual/input/inputN        -> itself (parent-level uevent)
    /devices/virtual/input/inputN/eventM -> /devices/virtual/input/inputN
    Anything else is returned unchanged.
    """
    base = devpath.rsplit("/", 1)[-1]
    if base.startswith("event"):
        return devpath.rsplit("/", 1)[0]
    return devpath


def generation_phys(generation):
    """The phys string the worker must set on its uinput device for this
    generation. Root-owned value: the generation is minted by the broker
    and reaches the worker only through the scrubbed contract environment,
    and the dedicated UID runs no other process."""
    return "southbag:%d" % generation


class TopologyMonitor:
    """Owns the uevent socket, the baseline snapshot, and classification.

    The constructor opens and binds the socket BEFORE taking the baseline
    snapshot: any uevent emitted during the snapshot is queued on our own
    socket and observed at the first poll, closing the snapshot-to-listen
    window.

    `expected_phys`: the phys value the worker's synthetic output device
    must carry (generation_phys(generation)). When None, NO virtual input
    device is ever exempted.
    """

    def __init__(self, io, manifest, socket_factory=make_netlink_socket,
                 synthetic_name=SOUTHBAG_UINPUT_DEVICE_NAME,
                 expected_phys=None):
        self.io = io
        self.synthetic_name = synthetic_name
        self.expected_phys = expected_phys
        self.sock = socket_factory()  # FIRST: listening before any snapshot
        try:
            # Approved devpaths: the event node realpath and its parent
            # input device, so events at either tree level are caught.
            self.approved_devpaths = set()
            for d in manifest["devices"]:
                for recorded in (d["sysfs_realpath"], d["device_realpath"]):
                    self.approved_devpaths.add(
                        recorded[len(io.sysfs_root):]
                        if recorded.startswith(io.sysfs_root) else recorded)
            self.baseline = manifest_mod.snapshot_topology(io)  # SECOND
        except BaseException:
            self.sock.close()
            raise
        self._last_seq = None
        self._bound_synthetic_devpath = None
        self._ignored_synthetic_devpaths = set()

    # -- stream handling ------------------------------------------------

    def poll_once(self):
        """Drain every pending datagram. Any uncertainty raises
        MonitorTerminal. Returns the list of observed uevents (for logs)."""
        seen = []
        while True:
            try:
                data, _anc, flags, _addr = self.sock.recvmsg(RECV_BUFSIZE)
            except BlockingIOError:
                return seen
            except OSError as exc:
                if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    return seen
                if exc.errno == errno.ENOBUFS:
                    raise MonitorTerminal("uevent socket overflow (ENOBUFS)")
                raise MonitorTerminal("uevent socket read failure: %s" % exc)
            if flags & socket.MSG_TRUNC:
                raise MonitorTerminal("truncated uevent datagram (MSG_TRUNC)")
            if not data:
                raise MonitorTerminal("empty uevent datagram")
            # Only the kernel (sender pid 0) may originate uevents.
            # recvmsg on netlink yields addr=(pid, groups); anything else
            # is rejected - strict denial is not relaxed.
            if _addr is not None and _addr[0] != 0:
                raise MonitorTerminal(
                    "non-kernel uevent sender (pid=%d)" % _addr[0])
            ev = parse_uevent(data)
            self._check_sequence(ev)
            if self._classify(ev) == "terminal":
                raise MonitorTerminal(
                    "input topology %s on %s" % (ev.action, ev.devpath))
            seen.append(ev)

    def _check_sequence(self, ev):
        if self._last_seq is None:
            self._last_seq = ev.seqnum
            return
        if ev.seqnum <= self._last_seq:
            # Reordered or replayed stream: we cannot prove nothing was
            # lost between two observations. Fail closed.
            raise MonitorTerminal(
                "uevent sequence regression %d after %d" % (ev.seqnum, self._last_seq))
        if ev.seqnum != self._last_seq + 1:
            raise MonitorTerminal(
                "uevent sequence gap %d -> %d" % (self._last_seq, ev.seqnum))
        self._last_seq = ev.seqnum

    # -- classification ---------------------------------------------------

    def _classify(self, ev):
        if ev.subsystem != "input":
            return "ignore"
        approved = any(
            ev.devpath == p or ev.devpath.startswith(p + "/")
            for p in self.approved_devpaths
        )
        if ev.action in _REPROBE_ACTIONS:
            return "terminal" if approved else "ignore"
        if ev.action not in _TERMINAL_ACTIONS:
            # Unknown action on input: conservative. Approved set is
            # terminal; elsewhere we ignore but keep watching.
            return "terminal" if approved else "ignore"
        if ev.devpath.startswith("/devices/virtual/"):
            # uinput emits BOTH /devices/virtual/input/inputN (name and
            # phys directly inside that directory) and
            # /devices/virtual/input/inputN/eventM (device symlink
            # resolving to inputN). Normalize both to the single
            # canonical inputN directory so parent and event uevents are
            # ONE device, never two.
            canonical = _canonical_input_dir(ev.devpath)
            if canonical in self._ignored_synthetic_devpaths:
                return "ignore"
            if self._is_bound_synthetic(canonical):
                self._ignored_synthetic_devpaths.add(canonical)
                return "ignore"
            return "terminal"  # no arbitrary virtual input is admitted
        # Physical add/remove/change: approved or not, the keyboard
        # topology we snapshotted is no longer guaranteed.
        return "terminal"

    def _is_bound_synthetic(self, canonical_devpath):
        """True only for the EXACT worker-created virtual output device.

        `canonical_devpath` is the inputN directory (parent-level and
        event-level uevents are normalized by _classify). For uinput
        devices, name and phys live DIRECTLY inside inputN; for event
        paths the device symlink resolves to inputN - reading the
        canonical directory serves both.

        Recognition transaction (integrator-selected scheme):
          1. sysfs name == SOUTHBAG_UINPUT_DEVICE_NAME, AND
          2. sysfs phys == expected_phys ("southbag:<generation>"), AND
          3. path uniqueness: the first matching canonical path is bound;
             a SECOND distinct canonical path matching name+phys returns
             False here and is terminal in _classify.
        Preexisting matches never reach here: launch denies startup when
        any input device already carries the synthetic name or the
        expected phys. Any lookup failure means we cannot prove it is
        ours, so it is not ours.
        """
        if self.expected_phys is None:
            return False
        sysfs_path = self.io.sysfs_root + canonical_devpath
        try:
            name = self.io.read_text(sysfs_path + "/name")
            phys = self.io.read_text(sysfs_path + "/phys")
        except OSError:
            return False
        if name != self.synthetic_name or phys != self.expected_phys:
            return False
        if self._bound_synthetic_devpath is None:
            self._bound_synthetic_devpath = canonical_devpath
            return True
        return canonical_devpath == self._bound_synthetic_devpath



    # -- periodic snapshot recheck ---------------------------------------

    def recheck_snapshot(self):
        current = manifest_mod.snapshot_topology(self.io)
        if current != self.baseline:
            raise MonitorTerminal("physical topology snapshot changed")

    def fileno(self):
        return self.sock.fileno()

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass
