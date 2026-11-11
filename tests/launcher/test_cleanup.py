"""Bounded cleanup tests: TERM success, TERM->KILL escalation, and the
bounded-failure report. Scripted reaper + manual clock; no real signals."""

import pytest

from southbag_launcher.cleanup import BoundedKiller
from southbag_launcher.errors import CleanupIncomplete

from fakes import FakeClock


class ScriptedReaper:
    """waitpid(-pgid, WNOHANG) script: child exits only after `exit_after`
    signals, or never if exit_after is None."""

    def __init__(self, exit_after):
        self.signals = []
        self.exit_after = exit_after
        self.dead = False

    def killpg(self, pgid, sig):
        self.signals.append(sig)
        if self.exit_after is not None and len(self.signals) >= self.exit_after:
            self.dead = True

    def waitpid(self, pgid, flags):
        if self.dead:
            raise ChildProcessError
        return (0, 0)


def test_term_succeeds_within_grace():
    clock = FakeClock()
    reaper = ScriptedReaper(exit_after=1)
    killer = BoundedKiller(killpg=reaper.killpg, waitpid=reaper.waitpid,
                           monotonic=clock, sleep=clock.sleep)
    import signal
    assert killer.terminate(1234) == "terminated"
    assert reaper.signals == [signal.SIGTERM]
    assert clock.now < 1000.0 + 3.0


def test_escalates_to_kill_after_term_timeout():
    clock = FakeClock()
    reaper = ScriptedReaper(exit_after=2)
    killer = BoundedKiller(killpg=reaper.killpg, waitpid=reaper.waitpid,
                           monotonic=clock, sleep=clock.sleep)
    import signal
    assert killer.terminate(1234, term_timeout=2.0, kill_timeout=2.0) == "killed"
    assert reaper.signals == [signal.SIGTERM, signal.SIGKILL]
    # Bounded: no longer than the two windows plus polling.
    assert clock.now <= 1000.0 + 4.0 + 0.1


def test_never_empty_is_bounded_and_reported():
    clock = FakeClock()
    reaper = ScriptedReaper(exit_after=None)
    killer = BoundedKiller(killpg=reaper.killpg, waitpid=reaper.waitpid,
                           monotonic=clock, sleep=clock.sleep)
    with pytest.raises(CleanupIncomplete):
        killer.terminate(1234, term_timeout=1.0, kill_timeout=1.0)
    assert clock.now <= 1000.0 + 2.0 + 0.1
    import signal
    assert reaper.signals == [signal.SIGTERM, signal.SIGKILL]
