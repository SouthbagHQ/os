"""Topology monitor fail-closed tests: sequence, truncation, overflow,
read failures, approved-set changes, virtual admission, own-uinput
recognition, snapshot recheck."""

import errno

import pytest

from southbag_launcher.errors import MonitorTerminal
from southbag_launcher import manifest as m
from southbag_launcher.monitor import TopologyMonitor, parse_uevent

from fakes import FakeIO, FakeSocket, make_uevent

APPROVED_REALPATH = ("/sys/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0"
                     "/0003:046d:c31c.0001/input/input_event3/event3")


SYN_NAME = "Espanso virtual device"
SYN_PHYS = "southbag:4242"


def make_monitor(io=None, queue=(), synthetic_name=SYN_NAME,
                 expected_phys=SYN_PHYS):
    io = io or FakeIO()
    if not io.devices:
        io.add_keyboard()
    manifest = m.build_manifest(io)
    sock = FakeSocket(queue)
    mon = TopologyMonitor(io, manifest, socket_factory=lambda: sock,
                          synthetic_name=synthetic_name,
                          expected_phys=expected_phys)
    return mon, sock, io, manifest


def test_happy_ignores_non_input_and_unrelated_bind():
    mon, sock, io, _ = make_monitor()
    sock.push(make_uevent("add", "/devices/pci0000:00/x", subsystem="usb",
                          seqnum=10))
    sock.push(make_uevent("bind", "/devices/pci0000:00/y/input/input7/event7",
                          seqnum=11))
    events = mon.poll_once()
    assert len(events) == 2  # observed, classified ignore, not terminal


def test_sequence_gap_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(make_uevent("add", "/devices/pci/a", subsystem="usb", seqnum=5))
    mon.poll_once()
    sock.push(make_uevent("add", "/devices/pci/b", subsystem="usb", seqnum=7))
    with pytest.raises(MonitorTerminal, match="sequence gap"):
        mon.poll_once()


def test_sequence_regression_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(make_uevent("add", "/devices/pci/a", subsystem="usb", seqnum=5))
    mon.poll_once()
    sock.push(make_uevent("add", "/devices/pci/b", subsystem="usb", seqnum=5))
    with pytest.raises(MonitorTerminal, match="regression"):
        mon.poll_once()


def test_truncation_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(("trunc", make_uevent("add", "/devices/pci/a", seqnum=5)))
    with pytest.raises(MonitorTerminal, match="truncated"):
        mon.poll_once()


def test_overflow_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(("error", errno.ENOBUFS))
    with pytest.raises(MonitorTerminal, match="ENOBUFS"):
        mon.poll_once()


def test_read_failure_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(("error", errno.ECONNREFUSED))
    with pytest.raises(MonitorTerminal, match="read failure"):
        mon.poll_once()


def test_malformed_datagram_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(b"no-at-sign-here\x00SUBSYSTEM=input\x00SEQNUM=3\x00")
    with pytest.raises(MonitorTerminal, match="malformed"):
        mon.poll_once()


def test_missing_seqnum_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(b"add@/devices/pci/a\x00SUBSYSTEM=input\x00")
    with pytest.raises(MonitorTerminal, match="malformed"):
        mon.poll_once()


def test_approved_remove_is_terminal():
    mon, sock, io, manifest = make_monitor()
    devpath = manifest["devices"][0]["sysfs_realpath"][len("/sys"):]
    sock.push(make_uevent("remove", devpath, devname="input/event3", seqnum=1))
    with pytest.raises(MonitorTerminal, match="topology remove"):
        mon.poll_once()


def test_approved_change_below_input_dir_is_terminal():
    mon, sock, io, manifest = make_monitor()
    devpath = manifest["devices"][0]["device_realpath"][len("/sys"):] + "/power"
    sock.push(make_uevent("change", devpath, seqnum=1))
    with pytest.raises(MonitorTerminal):
        mon.poll_once()


def test_other_physical_add_is_terminal():
    mon, sock, _, _ = make_monitor()
    sock.push(make_uevent(
        "add", "/devices/pci0000:00/newusb/input/input8/event8",
        devname="input/event8", seqnum=1))
    with pytest.raises(MonitorTerminal, match="topology add"):
        mon.poll_once()


def test_own_synthetic_real_style_parent_and_event_sequence():
    # Real uinput emission style: parent inputN add, event eventM add,
    # event remove, parent remove - all ONE canonical device, all
    # ignored, never double-counted.
    io = FakeIO()
    io.add_keyboard()
    io.add_keyboard(event_name="event9", name=SYN_NAME,
                    virtual=True, dev="13:99", phys=SYN_PHYS)
    mon, sock, _, _ = make_monitor(io=io)
    parent = "/devices/virtual/input/input9"
    event = parent + "/event9"
    sock.push(make_uevent("add", parent, seqnum=1))
    mon.poll_once()  # binds canonical input9
    sock.push(make_uevent("add", event, devname="input/event9", seqnum=2))
    mon.poll_once()  # same canonical: ignored, no second binding
    sock.push(make_uevent("remove", event, seqnum=3))
    sock.push(make_uevent("remove", parent, seqnum=4))
    events = mon.poll_once()
    assert len(events) == 2  # removals ignored; no terminal anywhere
    assert mon._bound_synthetic_devpath == parent


def test_parent_level_add_of_own_synthetic_alone_is_ignored():
    # The parent-level inputN add must pass the identity lookup by
    # reading name/phys directly from inputN (regression: reading
    # inputN/device/name fails because inputN has no device symlink).
    io = FakeIO()
    io.add_keyboard()
    io.add_keyboard(event_name="event9", name=SYN_NAME,
                    virtual=True, dev="13:99", phys=SYN_PHYS)
    mon, sock, _, _ = make_monitor(io=io)
    sock.push(make_uevent("add", "/devices/virtual/input/input9", seqnum=1))
    events = mon.poll_once()
    assert len(events) == 1


def test_same_name_wrong_phys_is_terminal():
    # Unrelated virtual device spoofing the synthetic NAME only: the phys
    # half of the recognition transaction must deny it. Tested at BOTH
    # the parent and event level.
    for devpath in ("/devices/virtual/input/input9",
                    "/devices/virtual/input/input9/event9"):
        io = FakeIO()
        io.add_keyboard()
        io.add_keyboard(event_name="event9", name=SYN_NAME,
                        virtual=True, dev="13:99", phys="uinput")
        mon, sock, _, _ = make_monitor(io=io)
        sock.push(make_uevent("add", devpath, seqnum=1))
        with pytest.raises(MonitorTerminal, match="topology add"):
            mon.poll_once()


def test_same_name_other_generation_phys_is_terminal():
    # A stale device from an older generation (phys southbag:<old>) is
    # not this generation's output device.
    io = FakeIO()
    io.add_keyboard()
    io.add_keyboard(event_name="event9", name=SYN_NAME,
                    virtual=True, dev="13:99", phys="southbag:4241")
    mon, sock, _, _ = make_monitor(io=io)
    sock.push(make_uevent("add", "/devices/virtual/input/input9/event9",
                          devname="input/event9", seqnum=1))
    with pytest.raises(MonitorTerminal, match="topology add"):
        mon.poll_once()


def test_second_canonical_input_device_is_terminal():
    # Path uniqueness at the canonical inputN level: after one device
    # binds, a second distinct inputN with matching name+phys must not
    # be admitted - whether its uevent arrives at parent or event level.
    for second in ("/devices/virtual/input/input10",
                   "/devices/virtual/input/input10/event10"):
        io = FakeIO()
        io.add_keyboard()
        io.add_keyboard(event_name="event9", name=SYN_NAME,
                        virtual=True, dev="13:99", phys=SYN_PHYS)
        io.add_keyboard(event_name="event10", name=SYN_NAME,
                        virtual=True, dev="13:100", phys=SYN_PHYS)
        mon, sock, _, _ = make_monitor(io=io)
        sock.push(make_uevent("add", "/devices/virtual/input/input9",
                              seqnum=1))
        mon.poll_once()  # first canonical device binds, ignored
        sock.push(make_uevent("add", second, seqnum=2))
        with pytest.raises(MonitorTerminal, match="topology add"):
            mon.poll_once()


def test_no_expected_phys_means_no_exemption():
    io = FakeIO()
    io.add_keyboard()
    io.add_keyboard(event_name="event9", name=SYN_NAME,
                    virtual=True, dev="13:99", phys=SYN_PHYS)
    mon, sock, _, _ = make_monitor(io=io, expected_phys=None)
    sock.push(make_uevent("add", "/devices/virtual/input/input9/event9",
                          devname="input/event9", seqnum=1))
    with pytest.raises(MonitorTerminal, match="topology add"):
        mon.poll_once()


def test_other_virtual_input_is_terminal():
    io = FakeIO()
    io.add_keyboard()
    io.add_keyboard(event_name="event9", name="Evil Virtual Keyboard",
                    virtual=True, dev="13:99")
    mon, sock, _, _ = make_monitor(io=io)
    sock.push(make_uevent("add", "/devices/virtual/input/input9/event9",
                          devname="input/event9", seqnum=1))
    with pytest.raises(MonitorTerminal, match="topology add"):
        mon.poll_once()


def test_virtual_name_unresolvable_is_terminal():
    # The device vanished between uevent and name lookup: we cannot prove
    # it was ours, so it is not ignored.
    mon, sock, _, _ = make_monitor()
    sock.push(make_uevent("add", "/devices/virtual/input/input77/event7",
                          devname="input/event7", seqnum=1))
    with pytest.raises(MonitorTerminal, match="topology add"):
        mon.poll_once()


def test_canonical_input_dir():
    from southbag_launcher.monitor import _canonical_input_dir
    p = "/devices/virtual/input/input9"
    assert _canonical_input_dir(p) == p
    assert _canonical_input_dir(p + "/event9") == p


UDEV_STYLE_PAYLOAD = (
    b"udev\x00"  # libudev monitor magic, NOT an action@devpath header
    + b"\x00" * 8
    + b"ACTION=add\x00DEVPATH=/devices/virtual/input/input9\x00"
)


def test_group2_udev_payload_is_never_delivered():
    # Real-flow regression for the guest startup blocker: udev's
    # userspace group-2 envelope must be excluded by subscription, not
    # by parsing. The monitor subscribes group 1 only; a udev-style
    # payload on group 2 provably never reaches poll_once.
    mon, sock, _, _ = make_monitor()
    assert sock.groups == 1
    sock.push(UDEV_STYLE_PAYLOAD, sender_pid=5454, group=2)
    sock.push(make_uevent("add", "/devices/pci0000:00/x", subsystem="usb",
                          seqnum=10))
    events = mon.poll_once()
    assert [e.subsystem for e in events] == ["usb"]  # only the kernel one


def test_udev_style_payload_on_kernel_group_stays_terminal():
    # Malformed-message denial is NOT relaxed: if a udev-envelope-shaped
    # payload ever arrived on group 1 from the kernel, it is still
    # terminal, never parsed leniently.
    mon, sock, _, _ = make_monitor()
    sock.push(UDEV_STYLE_PAYLOAD, sender_pid=0, group=1)
    with pytest.raises(MonitorTerminal, match="malformed"):
        mon.poll_once()


def test_non_pid0_sender_is_rejected():
    # A well-formed kobject message from a userspace sender is not a
    # kernel uevent. Rejected, strictly.
    mon, sock, _, _ = make_monitor()
    sock.push(make_uevent("add", "/devices/pci0000:00/x", subsystem="usb",
                          seqnum=10), sender_pid=1234, group=1)
    with pytest.raises(MonitorTerminal, match="non-kernel"):
        mon.poll_once()


def test_recheck_detects_snapshot_drift():
    mon, sock, io, _ = make_monitor()
    mon.recheck_snapshot()  # stable: no raise
    io.remove_device("event3")
    with pytest.raises(MonitorTerminal, match="snapshot changed"):
        mon.recheck_snapshot()


def test_parse_uevent_roundtrip():
    ev = parse_uevent(make_uevent("add", "/devices/x", devname="input/event0",
                                  seqnum=42))
    assert (ev.action, ev.devpath, ev.seqnum) == ("add", "/devices/x", 42)
    assert ev.subsystem == "input"


def test_socket_opens_before_baseline_snapshot():
    # Regression test for the unmonitored-window bug: the constructor
    # must bind the netlink socket BEFORE reading any sysfs state, so a
    # uevent emitted during the snapshot is queued on our own socket.
    log = []
    io = FakeIO()
    io.add_keyboard()
    orig_listdir = io.listdir

    def logged_listdir(path):
        log.append("listdir")
        return orig_listdir(path)

    io.listdir = logged_listdir

    def factory():
        log.append("socket")
        return FakeSocket()

    manifest = m.build_manifest(io)
    log.clear()  # discovery traffic is not part of the monitor window
    TopologyMonitor(io, manifest, socket_factory=factory)
    assert log.index("socket") < log.index("listdir")


def test_device_appearing_after_socket_open_is_in_baseline():
    # A device added between socket bind and snapshot read is captured by
    # the baseline (no blind spot): here the socket factory itself adds
    # the device, then the snapshot must include it.
    io = FakeIO()
    io.add_keyboard()

    def factory():
        io.add_keyboard(event_name="event4", name="Second Keyboard",
                        dev="13:68")
        return FakeSocket()

    manifest = m.build_manifest(io)
    mon = TopologyMonitor(io, manifest, socket_factory=factory)
    names = [row[0] for row in mon.baseline]
    assert "event4" in names
