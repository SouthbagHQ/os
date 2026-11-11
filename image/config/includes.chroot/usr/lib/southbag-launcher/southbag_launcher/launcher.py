"""Root-owned launcher: validation, open transaction, spawn, supervision.

Orchestration order (design doc, runtime section):

1. refuse if a consumed/terminal generation barrier exists;
2. load + validate the root-only manifest;
3. establish the topology monitor: its constructor binds the netlink
   socket FIRST, then takes the baseline snapshot - no unmonitored window;
4. deny any preexisting input device carrying the synthetic output name
   or this generation's phys;
5. open exactly the manifest's input nodes
   (O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC) and /dev/uinput
   (O_WRONLY|O_NONBLOCK|O_CLOEXEC|O_NOFOLLOW), validating each opened FD
   against fstat + ioctl identity;
6. TOCTOU gate: snapshot B + monitor-queue drain;
7. persist the consumed-generation barrier BEFORE fork - a launcher crash
   or a later marker-write failure can never permit rearm;
8. fork the child with ONLY the intended inherited FD set, a scrubbed
   environment (exactly the four contract variables), supplementary
   groups cleared, dedicated UID/GID, no capabilities, no-new-privileges;
9. parent immediately closes its input/uinput copies, retaining only the
   monitor pipe and process supervision;
10. on monitor uncertainty, or on ANY worker exit absent an explicit
    broker stop (including exit code 0): terminal - signal the worker,
    bounded cleanup, marker to state=terminal, exit non-zero. The unit
    has Restart=no, and setup never clears the barrier within one boot.

Exit codes: 0 clean broker stop; 2 admission denied (worker never ran);
3 terminal loss.
"""

import fcntl
import os
import selectors
import signal
import sys
import time

from . import CONTRACT_ENV_KEYS, SOUTHBAG_UINPUT_DEVICE_NAME
from . import manifest as manifest_mod, monitor as monitor_mod, sysfsio
from .cleanup import BoundedKiller
from .errors import CleanupIncomplete, Deny, MonitorTerminal
from .sysfsio import DeviceIO

EXIT_CLEAN = 0
EXIT_DENY = 2
EXIT_TERMINAL = 3

DEFAULT_RUNTIME_DIR = "/run/southbag-kevin"
BARRIER_FILE = "generation-barrier"

# Highest capability index we try to drop from the bounding set.
# Unknown indices return EINVAL and are skipped.
_MAX_CAP = 40


def default_boot_id():
    with open("/proc/sys/kernel/random/boot_id", "r") as fh:
        return fh.read().strip()


def build_grant_env(generation, grants, monitor_fd, uinput_fd):
    """The child's entire environment, exactly per contract section 1.

    `grants` is a list of (fd, token). fds and tokens must each be unique;
    generation must be a decimal u64 > 0. Any violation is a Deny: the
    child must never see a malformed grant set.
    """
    if not isinstance(generation, int) or generation <= 0 or generation >= 2**64:
        raise Deny("invalid generation: %r" % (generation,))
    fds = [fd for fd, _ in grants] + [monitor_fd, uinput_fd]
    if any(not isinstance(fd, int) or fd < 3 for fd in fds):
        raise Deny("grant fds must be integers >= 3: %r" % (fds,))
    if len(set(fds)) != len(fds):
        raise Deny("duplicate fds in grant set")
    tokens = [t for _, t in grants]
    if len(set(tokens)) != len(tokens):
        raise Deny("duplicate tokens in grant set")
    for token in tokens:
        if not manifest_mod.TOKEN_RE.match(token):
            raise Deny("contract-illegal token: %r" % token)
    grant_str = ",".join("%d=%s" % (fd, token) for fd, token in grants)
    return {
        "SOUTHBAG_WORKER_GENERATION": str(generation),
        "SOUTHBAG_INPUT_GRANTS": grant_str,
        "SOUTHBAG_MONITOR_FD": str(monitor_fd),
        "SOUTHBAG_UINPUT_FD": str(uinput_fd),
    }


def _prctl(option, arg2=0, arg3=0, arg4=0, arg5=0):
    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    PRCTL = 157  # x86-64/aarch64 syscall number for prctl
    rc = libc.syscall(PRCTL, option, arg2, arg3, arg4, arg5)
    return rc, ctypes.get_errno()


def drop_privileges(uid, gid):
    """Child-side privilege reduction, in an order that cannot re-widen.

    Runs after fork, before exec, while still root:
      setgroups([]) -> no_new_privs -> drop every bounding capability ->
      setgid -> setuid.
    setuid(non-root) then clears the permitted/effective capability sets
    under the default securebits, so the exec'd worker holds no
    capabilities, no supplementary groups, and cannot regain any.
    """
    PR_SET_NO_NEW_PRIVS = 38
    PR_CAPBSET_DROP = 24
    os.setgroups([])
    rc, err = _prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
    if rc != 0:
        raise OSError(err, "prctl(PR_SET_NO_NEW_PRIVS) failed")
    for cap in range(_MAX_CAP + 1):
        rc, err = _prctl(PR_CAPBSET_DROP, cap, 0, 0, 0)
        if rc != 0 and err not in (22,):  # EINVAL: unknown cap index
            raise OSError(err, "prctl(PR_CAPBSET_DROP, %d) failed" % cap)
    os.setgid(gid)
    os.setuid(uid)


def prepare_inheritance(inherit_fds):
    """Clear FD_CLOEXEC on exactly the intended inherited FD set and close
    every other fd > 2. Runs in the child after fork.

    This is what makes the grant set exact: anything not listed is gone
    before exec, so no parent fd (manifest fd, netlink socket, pipe write
    end) can leak into the worker.
    """
    keep = {0, 1, 2} | set(inherit_fds)
    for fd in inherit_fds:
        flags = fcntl.fcntl(fd, fcntl.F_GETFD)
        fcntl.fcntl(fd, fcntl.F_SETFD, flags & ~fcntl.FD_CLOEXEC)
    try:
        live = [int(e) for e in os.listdir("/proc/self/fd")]
    except OSError:
        maxfd = os.sysconf("SC_OPEN_MAX")
        live = list(range(3, min(maxfd, 65536)))
    for fd in live:
        if fd not in keep:
            try:
                os.close(fd)
            except OSError:
                pass
    return keep


def spawn_child(worker_argv, env, inherit_fds, uid=None, gid=None):
    """Fork + exec the worker. Child gets a new process group so bounded
    cleanup can signal every descendant at once. Identity drop is skipped
    when uid/gid are None (synthetic tests, developer runs)."""
    pid = os.fork()
    if pid != 0:
        return pid
    # ---- child ----
    try:
        os.setpgid(0, 0)
    except OSError:
        pass
    try:
        prepare_inheritance(inherit_fds)
        if uid is not None and gid is not None:
            drop_privileges(uid, gid)
        os.execve(worker_argv[0], list(worker_argv), dict(env))
    except BaseException as exc:  # never return into parent's frame
        try:
            os.write(2, ("southbag launcher child pre-exec failure: %r\n"
                         % (exc,)).encode())
        finally:
            os._exit(127)


def deny_preexisting_synthetic(io, synthetic_name, expected_phys):
    """Refuse startup if ANY existing input device already carries the
    synthetic output name or this generation's phys. The recognition
    transaction is only sound when the namespace starts clean: a
    preexisting same-name or same-phys device must never be accepted as
    the worker's own output. A virtual device whose identity cannot even
    be read is ambiguous and also denies.
    """
    for event_name in sysfsio.enumerate_event_names(io):
        cpath = sysfsio.class_path(io, event_name)
        realpath = io.realpath(cpath)
        device_realpath = io.realpath(cpath + "/device")
        name = sysfsio._read_optional(io, device_realpath + "/name")
        phys = sysfsio._read_optional(io, device_realpath + "/phys")
        if sysfsio.is_virtual_ancestry(io, realpath) and not name:
            raise Deny("unreadable identity on virtual input device %s; "
                       "ambiguous state denies startup" % event_name)
        if name == synthetic_name:
            raise Deny("preexisting input device %s already carries the "
                       "synthetic output name %r" % (event_name, synthetic_name))
        if expected_phys and phys == expected_phys:
            raise Deny("preexisting input device %s already carries phys %r"
                       % (event_name, expected_phys))


class Launcher:
    def __init__(self, config, io=None, store=None, socket_factory=None,
                 killer=None, clock=time.monotonic, boot_id_reader=None):
        self.config = config
        self.io = io or DeviceIO()
        self.store = store or manifest_mod.FileStore()
        self.socket_factory = socket_factory or monitor_mod.make_netlink_socket
        self.killer = killer or BoundedKiller()
        self.clock = clock
        self.boot_id_reader = boot_id_reader or default_boot_id
        self._stop_requested = False

    # -- config plumbing ------------------------------------------------

    @property
    def runtime_dir(self):
        return self.config.get("runtime_dir", DEFAULT_RUNTIME_DIR)

    @property
    def barrier_path(self):
        return os.path.join(self.runtime_dir, BARRIER_FILE)

    # Kept for compatibility with earlier notes; the barrier file is the
    # single marker.
    @property
    def terminal_marker(self):
        return self.barrier_path

    def _install_signal_handlers(self):
        def handler(_sig, _frame):
            self._stop_requested = True
        try:
            signal.signal(signal.SIGTERM, handler)
            signal.signal(signal.SIGINT, handler)
        except ValueError:
            # Not the main thread (embedded/test use): the embedder drives
            # _stop_requested directly.
            pass

    # -- generation barrier ----------------------------------------------

    def _read_barrier(self):
        try:
            with open(self.barrier_path, "r") as fh:
                fields = {}
                for line in fh:
                    key, sep, value = line.partition("=")
                    if sep:
                        fields[key.strip()] = value.strip()
                return fields
        except OSError:
            return None

    def _persist_barrier(self, state, generation, reason):
        os.makedirs(self.runtime_dir, mode=0o700, exist_ok=True)
        tmp = self.barrier_path + ".tmp"
        with open(tmp, "w") as fh:
            fh.write("state=%s\ngeneration=%d\nboot_id=%s\nreason=%s\n"
                     % (state, generation, self.boot_id_reader(), reason))
            fh.flush()
            os.fsync(fh.fileno())
        os.rename(tmp, self.barrier_path)

    # -- the run ----------------------------------------------------------

    def run(self):
        cfg = self.config
        worker_argv = cfg["worker_argv"]
        if not worker_argv or not os.path.isabs(worker_argv[0]):
            raise Deny("worker argv must start with an absolute path")

        barrier = self._read_barrier()
        if barrier is not None:
            raise Deny(
                "generation barrier present (state=%s generation=%s "
                "reason=%s): no automatic reuse or rearm. Only boot-time "
                "setup clears it, and never twice within one boot."
                % (barrier.get("state"), barrier.get("generation"),
                   barrier.get("reason")))

        manifest = manifest_mod.load_and_validate(
            self.store, self.io, cfg["manifest_path"])
        generation = manifest_mod.new_generation()
        synthetic_name = cfg.get("synthetic_name", SOUTHBAG_UINPUT_DEVICE_NAME)
        expected_phys = monitor_mod.generation_phys(generation)

        # Monitor BEFORE the snapshot/open transaction: its constructor
        # binds the netlink socket first, then snapshots the topology.
        monitor = monitor_mod.TopologyMonitor(
            self.io, manifest, socket_factory=self.socket_factory,
            synthetic_name=synthetic_name, expected_phys=expected_phys)

        input_fds = []
        grants = []
        uinput_fd = None
        mon_r = mon_w = None
        child_pid = None
        try:
            deny_preexisting_synthetic(self.io, synthetic_name, expected_phys)
            for entry in manifest["devices"]:
                fd = manifest_mod.validate_opened_device(self.io, entry)
                input_fds.append(fd)
                grants.append((fd, entry["token"]))
            uinput_fd = manifest_mod.open_uinput(self.io, manifest["uinput"])

            # TOCTOU gate: topology must be identical after the last open
            # to what the monitor baselined before the first, and no
            # uevent may have queued during the transaction.
            if manifest_mod.snapshot_topology(self.io) != monitor.baseline:
                raise Deny("topology changed during the open transaction")
            monitor.poll_once()  # raises MonitorTerminal on any queued event

            mon_r, mon_w = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
            env = build_grant_env(generation, grants, mon_r, uinput_fd)

            # Consumed-generation barrier BEFORE fork: if the launcher
            # crashes from here on, or the terminal-state rewrite below
            # ever fails, the barrier already denies any rearm.
            try:
                self._persist_barrier("consumed", generation, "start barrier")
            except OSError as exc:
                raise Deny("cannot persist consumed-generation barrier: %s"
                           % exc)

            inherit = [fd for fd, _ in grants] + [mon_r, uinput_fd]
            child_pid = spawn_child(
                worker_argv, env, inherit,
                uid=cfg.get("uid"), gid=cfg.get("gid"))
        except BaseException:
            for fd in input_fds + ([uinput_fd] if uinput_fd is not None else []):
                try:
                    self.io.close(fd)
                except OSError:
                    pass
            for fd in (mon_r, mon_w):
                if fd is not None:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            monitor.close()
            raise

        # Parent: immediately drop its copies of the child-held FDs. Only
        # the monitor pipe write end and supervision remain.
        for fd in input_fds + [uinput_fd, mon_r]:
            try:
                self.io.close(fd)
            except OSError:
                pass

        self._install_signal_handlers()
        return self._supervise(monitor, mon_w, child_pid, generation)

    # -- supervision ------------------------------------------------------

    def _signal_worker_loss(self, mon_w):
        """Any readiness or hangup on SOUTHBAG_MONITOR_FD means loss."""
        try:
            os.write(mon_w, b"\x01")
        except OSError:
            pass
        try:
            os.close(mon_w)
        except OSError:
            pass

    def _mark_terminal(self, generation, reason):
        # A persisted barrier is not visible in journalctl. Always explain why
        # enforcement stopped, including ordinary topology/worker failures.
        print("southbag launcher: terminal generation=%s reason=%s"
              % (generation, reason), file=sys.stderr, flush=True)
        try:
            self._persist_barrier("terminal", generation, reason)
        except OSError as exc:
            # The consumed barrier is already on disk (persisted before
            # fork), so rearm is still denied; report loudly.
            print("southbag launcher: terminal barrier rewrite failed "
                  "(consumed barrier still denies rearm): %s" % exc,
                  file=sys.stderr, flush=True)

    def _supervise(self, monitor, mon_w, child_pid, generation):
        cfg = self.config
        snapshot_interval = cfg.get("snapshot_interval", 5.0)
        term_timeout = cfg.get("term_timeout", 3.0)
        kill_timeout = cfg.get("kill_timeout", 3.0)
        sel = selectors.DefaultSelector()
        sel.register(monitor.fileno(), selectors.EVENT_READ)
        next_recheck = self.clock() + snapshot_interval
        child_status = None
        terminal_reason = None

        try:
            while True:
                if self._stop_requested:
                    break
                timeout = max(0.0, min(0.25, next_recheck - self.clock()))
                events = sel.select(timeout)
                if events:
                    try:
                        monitor.poll_once()
                    except MonitorTerminal as exc:
                        terminal_reason = str(exc)
                        break
                if self.clock() >= next_recheck:
                    try:
                        monitor.recheck_snapshot()
                    except (MonitorTerminal, Deny) as exc:
                        terminal_reason = str(exc)
                        break
                    next_recheck = self.clock() + snapshot_interval
                pid, status = os.waitpid(child_pid, os.WNOHANG)
                if pid == child_pid:
                    child_status = status
                    break
        finally:
            sel.close()
            monitor.close()

        if terminal_reason is not None:
            # Monitor lost: signal worker over the monitor FD, stop the
            # unit, mark terminal, no restart, no rearm. The terminal
            # reason is persisted in a finally: a cleanup failure (e.g.
            # PermissionError signalling the dedicated-UID child when the
            # parent's bounding set lacks CAP_KILL) must never skip it.
            self._signal_worker_loss(mon_w)
            try:
                self._bounded_stop(child_pid, term_timeout, kill_timeout)
            except CleanupIncomplete as exc:
                print("southbag launcher: %s" % exc, file=sys.stderr, flush=True)
            finally:
                self._mark_terminal(generation, terminal_reason)
            return EXIT_TERMINAL

        if self._stop_requested:
            # Explicit broker stop: forward to the child FIRST (a monitor
            # pipe hangup reaching a still-running worker would read as
            # monitor loss), bounded cleanup, clean exit. The barrier
            # stays 'consumed'. Cleanup failure is reported; systemd's
            # cgroup-wide final kill is the backstop.
            try:
                self._bounded_stop(child_pid, term_timeout, kill_timeout)
            except CleanupIncomplete as exc:
                print("southbag launcher: %s" % exc, file=sys.stderr, flush=True)
            try:
                os.close(mon_w)
            except OSError:
                pass
            return EXIT_CLEAN

        # The worker exited without an explicit broker stop. Every such
        # exit is terminal, including exit code 0: the contract has the
        # worker exit only on TerminalFailure or broker stop, so anything
        # else means we can no longer stand behind the grant set.
        try:
            os.close(mon_w)
        except OSError:
            pass
        try:
            self._bounded_stop(child_pid, term_timeout, kill_timeout)
        except CleanupIncomplete as exc:
            print("southbag launcher: %s" % exc, file=sys.stderr, flush=True)
        finally:
            self._mark_terminal(
                generation,
                "unexpected worker exit (status=0x%x, no broker stop)"
                % child_status)
        return EXIT_TERMINAL

    def _bounded_stop(self, child_pid, term_timeout, kill_timeout):
        """Terminate the child's process group, bounded.

        Every signal/cleanup failure (PermissionError on killpg when the
        parent lacks CAP_KILL for the dedicated-UID child, any other
        OSError, and the killer's own timeout) is reported as
        CleanupIncomplete - it never crashes the monitor path. A vanished
        child is not a failure.
        """
        try:
            pgid = os.getpgid(child_pid)
        except ProcessLookupError:
            return "already-gone"
        except OSError as exc:
            raise CleanupIncomplete(
                "cannot resolve child process group %d: %s"
                % (child_pid, exc))
        try:
            return self.killer.terminate(pgid, term_timeout, kill_timeout)
        except CleanupIncomplete:
            raise
        except OSError as exc:
            # PermissionError (missing CAP_KILL) and any other signal
            # failure land here. systemd's KillMode=control-group stop is
            # the final barrier; we report, not crash.
            raise CleanupIncomplete(
                "bounded cleanup of pgid %d failed: %s" % (pgid, exc))


# ---------------------------------------------------------------------------
# Boot-time setup (separate entry point; also writes the DeviceAllow drop-in)
# ---------------------------------------------------------------------------

DROPIN_TEMPLATE = """# Managed by southbag-kevin-launcher setup; regenerated at boot.
# Exact per-device grants only. Device-class wildcards are never emitted.
[Service]
DevicePolicy=closed
{device_lines}"""


def render_dropin(manifest):
    lines = []
    for d in manifest["devices"]:
        lines.append("DeviceAllow=%s r" % d["event_node"])
    lines.append("DeviceAllow=%s w" % manifest["uinput"]["path"])
    return DROPIN_TEMPLATE.format(device_lines="\n".join(lines)) + "\n"


def run_setup(config, io=None, store=None, write_dropin=True,
              boot_id_reader=None):
    """Discover physical keyboards, write the root-only manifest, render
    the per-device systemd drop-in, and clear a stale generation barrier.

    The barrier is cleared ONLY across boots: a barrier whose recorded
    boot_id equals the current boot is left in place, so setup can never
    re-arm a consumed or terminal generation within the same boot.
    """
    io = io or DeviceIO()
    store = store or manifest_mod.FileStore()
    boot_id_reader = boot_id_reader or default_boot_id
    runtime_dir = config.get("runtime_dir", DEFAULT_RUNTIME_DIR)
    manifest = manifest_mod.build_manifest(io)
    store.write_atomic_rootonly(config["manifest_path"], manifest_mod.serialize(manifest))

    barrier_path = os.path.join(runtime_dir, BARRIER_FILE)
    try:
        with open(barrier_path, "r") as fh:
            fields = dict(
                (k.strip(), v.strip())
                for k, sep, v in
                (line.partition("=") for line in fh) if sep)
        same_boot = fields.get("boot_id") == boot_id_reader()
    except OSError:
        same_boot = False
    if not same_boot:
        try:
            os.unlink(barrier_path)
        except OSError:
            pass

    dropin = render_dropin(manifest)
    if write_dropin and config.get("dropin_path"):
        directory = os.path.dirname(config["dropin_path"])
        os.makedirs(directory, exist_ok=True)
        with open(config["dropin_path"], "w") as fh:
            fh.write(dropin)
    return manifest, dropin
