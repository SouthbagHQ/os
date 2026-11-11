"""Bounded descendant cleanup.

On any terminal loss (or broker stop) the launcher terminates the whole
child process group with SIGTERM, waits a bounded grace, escalates to
SIGKILL, waits again, and reports. It never waits forever, and it never
pretends success it cannot verify: if anything is still unreaped after
the KILL window, CleanupIncomplete is raised so the stop broker (the
systemd unit, KillMode=control-group) performs and verifies the final
cgroup-empty state.

All time/kill/wait operations are injectable for deterministic tests.
"""

import errno
import os
import signal
import time

from .errors import CleanupIncomplete


class BoundedKiller:
    def __init__(self, killpg=os.killpg, waitpid=os.waitpid,
                 monotonic=time.monotonic, sleep=time.sleep,
                 poll_interval=0.05):
        self._killpg = killpg
        self._waitpid = waitpid
        self._monotonic = monotonic
        self._sleep = sleep
        self._poll_interval = poll_interval

    def _signal(self, pgid, sig):
        try:
            self._killpg(pgid, sig)
        except ProcessLookupError:
            pass

    def _reap_group(self, pgid):
        """Reap our children in pgid. Returns True when none remain that
        we can observe (ECHILD). Grandchildren reparented away are covered
        by the group signal; the cgroup-empty proof stays with systemd."""
        while True:
            try:
                pid, _status = self._waitpid(-pgid, os.WNOHANG)
            except ChildProcessError:
                return True
            except OSError as exc:
                if exc.errno == errno.ECHILD:
                    return True
                raise
            if pid == 0:
                return False

    def _wait_until_empty(self, pgid, deadline):
        while True:
            if self._reap_group(pgid):
                return True
            if self._monotonic() >= deadline:
                return False
            self._sleep(min(self._poll_interval, max(0.0, deadline - self._monotonic())))

    def terminate(self, pgid, term_timeout=3.0, kill_timeout=3.0):
        """SIGTERM group -> bounded wait -> SIGKILL group -> bounded wait.

        Total worst case is term_timeout + kill_timeout plus reap polling.
        Raises CleanupIncomplete if the group still is not empty after the
        KILL window.
        """
        self._signal(pgid, signal.SIGTERM)
        if self._wait_until_empty(pgid, self._monotonic() + term_timeout):
            return "terminated"
        self._signal(pgid, signal.SIGKILL)
        if self._wait_until_empty(pgid, self._monotonic() + kill_timeout):
            return "killed"
        raise CleanupIncomplete(
            "process group %d not empty after SIGKILL window" % pgid)
