#!/usr/bin/env python3
"""Synthetic worker child used by launcher end-to-end tests.

Stands in for the espanso worker binary: verifies the contract spawn
surface (exact environment, inherited FD set, nonblocking grants, no
CLOEXEC), reports over fd 1, then watches the monitor fd. Any readiness
or hangup there means monitor loss, per contract section 1. Exits 0 on
SIGTERM (broker stop), 3 on monitor loss, 42 on any contract violation.
"""

import fcntl
import os
import signal
import sys

CONTRACT_KEYS = {
    "SOUTHBAG_WORKER_GENERATION",
    "SOUTHBAG_INPUT_GRANTS",
    "SOUTHBAG_MONITOR_FD",
    "SOUTHBAG_UINPUT_FD",
}


def fail(msg):
    os.write(1, ("CHILD_CONTRACT_VIOLATION: %s\n" % msg).encode())
    os._exit(42)


def main():
    # CPython's locale coercion (PEP 538) injects LC_CTYPE into os.environ
    # when the ambient env lacks it; that is a synthetic-child artifact,
    # not a broker grant. The real (Rust) worker sees exactly the broker's
    # environment.
    env_keys = set(os.environ.keys()) - {"LC_CTYPE"}
    if env_keys != CONTRACT_KEYS:
        fail("environment is not exactly the contract set: %r"
             % sorted(os.environ.keys()))

    gen = os.environ["SOUTHBAG_WORKER_GENERATION"]
    if not gen.isdigit() or int(gen) <= 0:
        fail("bad generation %r" % gen)

    grants = {}
    for entry in os.environ["SOUTHBAG_INPUT_GRANTS"].split(","):
        fd_s, sep, token = entry.partition("=")
        if not sep:
            fail("malformed grant %r" % entry)
        grants[int(fd_s)] = token

    monitor_fd = int(os.environ["SOUTHBAG_MONITOR_FD"])
    uinput_fd = int(os.environ["SOUTHBAG_UINPUT_FD"])

    all_fds = list(grants) + [monitor_fd, uinput_fd]
    if len(set(all_fds)) != len(all_fds):
        fail("duplicate fds")
    for fd in all_fds:
        try:
            fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        except OSError:
            fail("fd %d not open" % fd)
        if not fl & os.O_NONBLOCK:
            fail("fd %d missing O_NONBLOCK" % fd)
        if fcntl.fcntl(fd, fcntl.F_GETFD) & fcntl.FD_CLOEXEC:
            fail("fd %d still CLOEXEC" % fd)

    # Every non-contract fd from the parent must be gone: probe a range.
    leaked = []
    for fd in range(3, 64):
        if fd in all_fds:
            continue
        try:
            os.fstat(fd)
            leaked.append(fd)
        except OSError:
            pass
    # Python itself opens no extra fds before this point on a bare -S run;
    # any leftover parent pipe (e.g. the FakeIO write ends) is a leak.
    leaked = [fd for fd in leaked if fd not in all_fds]
    if leaked:
        fail("leaked parent fds: %r" % leaked)

    os.write(1, ("CHILD_OK %d\n" % os.getpid()).encode())
    sys.stdout.flush()

    if "--exit-after-ok" in sys.argv:
        os._exit(0)

    def on_term(_sig, _frame):
        os._exit(0)

    signal.signal(signal.SIGTERM, on_term)

    # Wait for monitor loss: readiness of any kind (payload or hangup).
    import selectors
    sel = selectors.DefaultSelector()
    sel.register(monitor_fd, selectors.EVENT_READ)
    while True:
        sel.select()
        try:
            data = os.read(monitor_fd, 1)
            os._exit(3)  # payload or EOF: both are loss
        except BlockingIOError:
            continue


if __name__ == "__main__":
    main()
