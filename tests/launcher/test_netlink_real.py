"""Real-kernel netlink socket construction (integrator issue 1).

socket.NETLINK_KOBJECT_UEVENT is absent on the target's stdlib build, so
the monitor binds the numeric uapi constant 15
(include/uapi/linux/netlink.h, stable since 2.6). These tests exercise
the REAL socket constructor on Linux: no fakes involved.
"""

import socket
import sys

import pytest

from southbag_launcher.monitor import (NETLINK_KOBJECT_UEVENT,
                                       make_netlink_socket)


def test_constant_is_linux_uapi_15():
    assert NETLINK_KOBJECT_UEVENT == 15


@pytest.mark.skipif(not sys.platform.startswith("linux"),
                    reason="netlink kobject uevent is Linux-specific")
def test_real_socket_constructs_and_binds():
    sock = make_netlink_socket()
    try:
        assert sock.family == socket.AF_NETLINK
        assert sock.proto == 15
        assert sock.gettimeout() == 0.0  # nonblocking
        # Bound to kernel group 1 ONLY: udev's userspace group-2 envelope
        # must not be subscribed (guest startup blocker regression).
        _pid, groups = sock.getsockname()
        assert groups == 1
    finally:
        sock.close()
