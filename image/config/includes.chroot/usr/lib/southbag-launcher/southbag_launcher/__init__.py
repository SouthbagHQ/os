"""Southbag OS Kevin worker: root-owned physical-device launcher/monitor.

Implements the broker side of SOUTHBAG-WORKER-CONTRACT v4:

* boot-time discovery of non-virtual physical keyboards (sysfs ancestry +
  evdev capability checks) into a root-only immutable manifest;
* launch-time validation of that manifest against sysfs and opened-FD
  fstat data (event names alone never establish identity);
* a kernel input-topology monitor (netlink uevents + periodic physical
  snapshot recheck) established BEFORE the snapshot/open transaction;
* exact per-device FD grants opened O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC
  (inputs) and O_WRONLY|O_NONBLOCK|O_CLOEXEC (/dev/uinput), inherited by a
  dedicated-UID child with a scrubbed environment and no capability,
  network, or IPC widening;
* fail-closed behavior on topology/sequence/overflow/read uncertainty with
  bounded cleanup and no automatic rearm.

This package never scans /dev/input at worker runtime on behalf of the
child and never opens /dev/uinput by path in the child. The child receives
already-open capabilities only, per contract section 1.
"""

__all__ = [
    "evdev",
    "sysfsio",
    "manifest",
    "monitor",
    "cleanup",
    "launcher",
]

# Single source of truth on the broker side for the worker's synthetic
# output device name. Must stay identical to
# espanso_info::SOUTHBAG_UINPUT_DEVICE_NAME (contract section 1). If the
# espanso engineer changes that constant, this value must change in the
# same release; the monitor relies on it to ignore exactly the
# worker-created virtual output device and nothing else.
SOUTHBAG_UINPUT_DEVICE_NAME = "Espanso virtual device"

CONTRACT_ENV_KEYS = (
    "SOUTHBAG_WORKER_GENERATION",
    "SOUTHBAG_INPUT_GRANTS",
    "SOUTHBAG_MONITOR_FD",
    "SOUTHBAG_UINPUT_FD",
)
