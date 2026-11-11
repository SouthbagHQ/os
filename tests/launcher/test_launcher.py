"""Launcher tests: grant-env exactness, pre-start denies, TOCTOU gate,
and real-fork end-to-end runs with a synthetic worker child (happy path,
monitor-loss terminal, no automatic rearm)."""

import os
import sys
import threading
import time

import pytest

from southbag_launcher import manifest as m
from southbag_launcher.errors import Deny
from southbag_launcher.launcher import (EXIT_CLEAN, EXIT_DENY, EXIT_TERMINAL,
                                        Launcher, build_grant_env, render_dropin)

from fakes import FakeFileStore, FakeIO, FakeSocket, make_uevent

CHILD = os.path.join(os.path.dirname(__file__), "synthetic_child.py")


# -- grant env (contract section 1 surface) ---------------------------------

def test_grant_env_exact():
    env = build_grant_env(7, [(3, "tok-a"), (4, "tok-b")], 5, 6)
    assert env == {
        "SOUTHBAG_WORKER_GENERATION": "7",
        "SOUTHBAG_INPUT_GRANTS": "3=tok-a,4=tok-b",
        "SOUTHBAG_MONITOR_FD": "5",
        "SOUTHBAG_UINPUT_FD": "6",
    }


@pytest.mark.parametrize("gen", [0, -1, 2**64, "7", None])
def test_grant_env_denies_bad_generation(gen):
    with pytest.raises(Deny, match="generation"):
        build_grant_env(gen, [(3, "a")], 4, 5)


def test_grant_env_denies_duplicate_fd():
    with pytest.raises(Deny, match="duplicate fds"):
        build_grant_env(1, [(3, "a"), (3, "b")], 4, 5)


def test_grant_env_denies_fd_collision_with_monitor():
    with pytest.raises(Deny, match="duplicate fds"):
        build_grant_env(1, [(3, "a")], 3, 5)


def test_grant_env_denies_duplicate_token():
    with pytest.raises(Deny, match="duplicate tokens"):
        build_grant_env(1, [(3, "a"), (4, "a")], 5, 6)


def test_grant_env_denies_bad_token_charset():
    with pytest.raises(Deny, match="contract-illegal token"):
        build_grant_env(1, [(3, "bad token!")], 4, 5)


def test_grant_env_denies_low_fds():
    with pytest.raises(Deny, match=">= 3"):
        build_grant_env(1, [(2, "a")], 4, 5)


# -- drop-in rendering --------------------------------------------------------

def test_render_dropin_exact_devices_no_wildcard():
    io = FakeIO()
    io.add_keyboard()
    manifest = m.build_manifest(io)
    dropin = render_dropin(manifest)
    assert "DevicePolicy=closed" in dropin
    assert "DeviceAllow=/dev/input/event3 r\n" in dropin
    assert "DeviceAllow=/dev/uinput w\n" in dropin
    assert "char-input" not in dropin
    assert "rw" not in dropin


# -- pre-start denies -----------------------------------------------------------

def _config(tmp_path, **over):
    cfg = {
        "manifest_path": "/run/southbag/kevin/manifest.json",
        "runtime_dir": str(tmp_path),
        "worker_argv": [sys.executable, CHILD],
        "uid": None,
        "gid": None,
        "snapshot_interval": 60.0,
        "term_timeout": 2.0,
        "kill_timeout": 2.0,
    }
    cfg.update(over)
    return cfg


def _store_for(io):
    return FakeFileStore(content=m.serialize(m.build_manifest(io)))


def test_run_denies_relative_worker_path(tmp_path):
    io = FakeIO(); io.add_keyboard()
    launcher = Launcher(_config(tmp_path, worker_argv=["relative/worker"]),
                        io=io, store=_store_for(io),
                        socket_factory=FakeSocket)
    with pytest.raises(Deny, match="absolute path"):
        launcher.run()


def test_run_denies_missing_device_before_fork(tmp_path):
    io = FakeIO(); io.add_keyboard()
    store = _store_for(io)
    io.remove_device("event3")
    launcher = Launcher(_config(tmp_path), io=io, store=store,
                        socket_factory=FakeSocket)
    with pytest.raises(Deny):
        launcher.run()


def test_run_denies_toctou_change_during_open(tmp_path):
    io = FakeIO(); io.add_keyboard()
    store = _store_for(io)

    def hook(count, path):
        if path == "/dev/uinput":
            # Input fd already open; keyboard yanked before the
            # post-transaction snapshot.
            io.remove_device("event3")

    io.after_open_hook = hook
    launcher = Launcher(_config(tmp_path), io=io, store=store,
                        socket_factory=FakeSocket)
    with pytest.raises(Deny, match="topology changed during the open"):
        launcher.run()


# -- end-to-end with a real forked synthetic child ------------------------------

def _read_until(capfd, needle, timeout=15.0):
    deadline = time.monotonic() + timeout
    out = ""
    while time.monotonic() < deadline:
        out += capfd.readouterr().out
        if needle in out:
            return out
        time.sleep(0.05)
    raise AssertionError("timed out waiting for %r; got %r" % (needle, out))


def _run_in_thread(launcher):
    box = {}
    t = threading.Thread(target=lambda: box.setdefault(
        "rc", _run_guarded(launcher, box)), daemon=True)
    t.start()
    return t, box


def _run_guarded(launcher, box):
    try:
        return launcher.run()
    except BaseException as exc:
        box["exc"] = exc
        return -1


def _barrier_state(launcher):
    fields = {}
    with open(launcher.barrier_path) as fh:
        for line in fh:
            k, sep, v = line.partition("=")
            if sep:
                fields[k.strip()] = v.strip()
    return fields


def test_end_to_end_clean_broker_stop(tmp_path, capfd):
    io = FakeIO(); io.add_keyboard()
    sock = FakeSocket()
    launcher = Launcher(_config(tmp_path), io=io, store=_store_for(io),
                        socket_factory=lambda: sock)
    t, box = _run_in_thread(launcher)
    _read_until(capfd, "CHILD_OK")  # child verified the whole contract surface
    # The consumed-generation barrier was persisted BEFORE the fork.
    assert _barrier_state(launcher)["state"] == "consumed"
    launcher._stop_requested = True  # broker stop
    t.join(timeout=15)
    assert not t.is_alive()
    assert box.get("exc") is None
    assert box["rc"] == EXIT_CLEAN
    # Clean stop leaves the consumed barrier in place: no same-boot rearm.
    assert _barrier_state(launcher)["state"] == "consumed"
    io2 = FakeIO(); io2.add_keyboard()
    launcher2 = Launcher(_config(tmp_path), io=io2, store=_store_for(io2),
                         socket_factory=FakeSocket)
    with pytest.raises(Deny, match="generation barrier"):
        launcher2.run()


def test_end_to_end_monitor_loss_terminal_no_rearm(tmp_path, capfd):
    io = FakeIO(); io.add_keyboard()
    sock = FakeSocket()
    store = _store_for(io)
    launcher = Launcher(_config(tmp_path), io=io, store=store,
                        socket_factory=lambda: sock)
    t, box = _run_in_thread(launcher)
    _read_until(capfd, "CHILD_OK")
    # Physical removal of the approved keyboard, observed post-start.
    manifest = m.load_and_validate(store, io, "/run/southbag/kevin/manifest.json")
    devpath = manifest["devices"][0]["sysfs_realpath"][len("/sys"):]
    sock.push(make_uevent("remove", devpath, devname="input/event3", seqnum=1))
    t.join(timeout=15)
    assert not t.is_alive()
    assert box.get("exc") is None
    assert box["rc"] == EXIT_TERMINAL
    assert _barrier_state(launcher)["state"] == "terminal"
    # A second run is denied until a NEW boot's setup re-arms explicitly.
    io2 = FakeIO(); io2.add_keyboard()
    launcher2 = Launcher(_config(tmp_path), io=io2, store=_store_for(io2),
                         socket_factory=FakeSocket)
    with pytest.raises(Deny, match="generation barrier"):
        launcher2.run()


def test_unexpected_clean_exit_is_terminal(tmp_path, capfd):
    # Worker exits 0 WITHOUT an explicit broker stop: still terminal,
    # still marked, still no rearm.
    io = FakeIO(); io.add_keyboard()
    sock = FakeSocket()
    launcher = Launcher(
        _config(tmp_path, worker_argv=[sys.executable, CHILD,
                                       "--exit-after-ok"]),
        io=io, store=_store_for(io), socket_factory=lambda: sock)
    t, box = _run_in_thread(launcher)
    _read_until(capfd, "CHILD_OK")
    t.join(timeout=15)
    assert not t.is_alive()
    assert box.get("exc") is None
    assert box["rc"] == EXIT_TERMINAL
    assert _barrier_state(launcher)["state"] == "terminal"
    assert "unexpected worker exit" in _barrier_state(launcher)["reason"]


def test_unexpected_killed_exit_is_terminal(tmp_path, capfd):
    io = FakeIO(); io.add_keyboard()
    sock = FakeSocket()
    launcher = Launcher(_config(tmp_path), io=io, store=_store_for(io),
                        socket_factory=lambda: sock)
    t, box = _run_in_thread(launcher)
    out = _read_until(capfd, "CHILD_OK")
    pid = int(out.split("CHILD_OK", 1)[1].split()[0])
    os.kill(pid, 9)
    t.join(timeout=15)
    assert not t.is_alive()
    assert box.get("exc") is None
    assert box["rc"] == EXIT_TERMINAL
    assert _barrier_state(launcher)["state"] == "terminal"


def test_barrier_write_failure_denies_before_fork(tmp_path, capfd):
    # runtime_dir is an unwritable location (a regular file): the barrier
    # cannot be persisted, so the worker must never start.
    notadir = tmp_path / "notadir"
    notadir.write_text("x")
    io = FakeIO(); io.add_keyboard()
    launcher = Launcher(_config(tmp_path, runtime_dir=str(notadir)),
                        io=io, store=_store_for(io), socket_factory=FakeSocket)
    with pytest.raises(Deny, match="consumed-generation barrier"):
        launcher.run()
    time.sleep(0.5)
    assert "CHILD_OK" not in capfd.readouterr().out


def test_preexisting_synthetic_name_denies(tmp_path):
    io = FakeIO(); io.add_keyboard()
    io.add_keyboard(event_name="event9", name="Espanso virtual device",
                    virtual=True, dev="13:99")
    launcher = Launcher(_config(tmp_path), io=io, store=_store_for(io),
                        socket_factory=FakeSocket)
    with pytest.raises(Deny, match="preexisting.*synthetic output name"):
        launcher.run()


def test_preexisting_generation_phys_denies(tmp_path):
    # A device already carrying phys == southbag:<generation> is never
    # accepted as this generation's output device. The generation is
    # minted at run time, so pin it to prove the launcher compares phys
    # against ITS minted generation.
    io = FakeIO(); io.add_keyboard()
    io.add_keyboard(event_name="event9", name="some other device",
                    virtual=True, dev="13:99", phys="southbag:777")
    orig = m.new_generation
    m.new_generation = lambda previous=None: 777
    try:
        launcher = Launcher(_config(tmp_path), io=io, store=_store_for(io),
                            socket_factory=FakeSocket)
        with pytest.raises(Deny, match="preexisting.*phys"):
            launcher.run()
    finally:
        m.new_generation = orig


class _FailingKiller:
    def __init__(self, exc):
        self.exc = exc

    def terminate(self, pgid, term_timeout, kill_timeout):
        raise self.exc


def _reap_leftover(capfd_out):
    try:
        pid = int(capfd_out.split("CHILD_OK", 1)[1].split()[0])
    except (IndexError, ValueError):
        return
    try:
        os.kill(pid, 9)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


@pytest.mark.parametrize("failure", [
    PermissionError(1, "Operation not permitted"),  # missing CAP_KILL (guest repro)
    OSError(5, "Input/output error"),               # any other signal failure
])
def test_cleanup_signal_failure_reported_terminal_still_persisted(
        tmp_path, capfd, failure):
    # Guest repro: the monitor path must not crash when signalling the
    # child fails. The failure is reported as CleanupIncomplete, the
    # terminal reason is still persisted, and the run exits terminal.
    io = FakeIO(); io.add_keyboard()
    sock = FakeSocket()
    store = _store_for(io)
    launcher = Launcher(_config(tmp_path), io=io, store=store,
                        socket_factory=lambda: sock,
                        killer=_FailingKiller(failure))
    t, box = _run_in_thread(launcher)
    try:
        out = _read_until(capfd, "CHILD_OK")
        manifest = m.load_and_validate(store, io, "/run/southbag/kevin/manifest.json")
        devpath = manifest["devices"][0]["sysfs_realpath"][len("/sys"):]
        sock.push(make_uevent("remove", devpath, devname="input/event3",
                              seqnum=1))
        t.join(timeout=15)
    finally:
        out, err = capfd.readouterr()  # one readouterr: it drains BOTH
        _reap_leftover(out)
    assert not t.is_alive()
    assert box.get("exc") is None  # monitor path did NOT crash
    assert box["rc"] == EXIT_TERMINAL
    barrier = _barrier_state(launcher)
    assert barrier["state"] == "terminal"  # reason persisted despite failure
    assert "topology remove" in barrier["reason"]
    assert "bounded cleanup" in err  # CleanupIncomplete report


def test_bounded_stop_converts_getpgid_and_signal_errors(tmp_path):
    from southbag_launcher.errors import CleanupIncomplete
    launcher = Launcher(_config(tmp_path), io=FakeIO(), store=FakeFileStore(),
                        socket_factory=FakeSocket,
                        killer=_FailingKiller(PermissionError(1, "denied")))
    with pytest.raises(CleanupIncomplete, match="bounded cleanup"):
        launcher._bounded_stop(os.getpid(), 1.0, 1.0)


def test_cleanup_failure_on_broker_stop_still_clean_exit(
        tmp_path, capfd):
    io = FakeIO(); io.add_keyboard()
    sock = FakeSocket()
    launcher = Launcher(_config(tmp_path), io=io, store=_store_for(io),
                        socket_factory=lambda: sock,
                        killer=_FailingKiller(PermissionError(1, "denied")))
    t, box = _run_in_thread(launcher)
    try:
        _read_until(capfd, "CHILD_OK")
        launcher._stop_requested = True
        t.join(timeout=15)
    finally:
        out, err = capfd.readouterr()  # one readouterr: it drains BOTH
        _reap_leftover(out)
    assert not t.is_alive()
    assert box.get("exc") is None
    assert box["rc"] == EXIT_CLEAN
    assert _barrier_state(launcher)["state"] == "consumed"  # unchanged
    assert "bounded cleanup" in err  # CleanupIncomplete report


def test_setup_clears_barrier_only_across_boots(tmp_path):
    from southbag_launcher.launcher import run_setup
    marker_dir = tmp_path / "rt"
    marker_dir.mkdir()
    barrier = marker_dir / "generation-barrier"
    io = FakeIO(); io.add_keyboard()
    store = FakeFileStore()
    cfg = {
        "manifest_path": str(tmp_path / "manifest.json"),
        "dropin_path": str(tmp_path / "20-devices.conf"),
        "runtime_dir": str(marker_dir),
    }
    # Same boot: barrier survives setup.
    barrier.write_text("state=terminal\ngeneration=1\nboot_id=bootA\nreason=x\n")
    run_setup(cfg, io=io, store=store, boot_id_reader=lambda: "bootA")
    assert barrier.exists()
    # New boot: barrier cleared.
    run_setup(cfg, io=io, store=store, boot_id_reader=lambda: "bootB")
    assert not barrier.exists()
    assert store.written  # manifest persisted through the store seam
    assert "DeviceAllow=/dev/input/event3 r" in (tmp_path / "20-devices.conf").read_text()


def test_terminal_reason_is_logged_even_when_barrier_persist_succeeds(tmp_path, capsys):
    launcher = Launcher(_config(tmp_path), boot_id_reader=lambda: "test-boot")
    launcher._mark_terminal(42, "uevent sequence gap: 12 -> 14")
    assert "terminal generation=42 reason=uevent sequence gap: 12 -> 14" in capsys.readouterr().err
    assert launcher._read_barrier()["reason"] == "uevent sequence gap: 12 -> 14"


def test_terminal_reason_is_logged_when_barrier_write_fails(tmp_path, capsys, monkeypatch):
    launcher = Launcher(_config(tmp_path))
    def fail(*_args):
        raise OSError("read-only")
    monkeypatch.setattr(launcher, "_persist_barrier", fail)
    launcher._mark_terminal(43, "approved keyboard removed")
    text = capsys.readouterr().err
    assert "terminal generation=43 reason=approved keyboard removed" in text
    assert "terminal barrier rewrite failed" in text
