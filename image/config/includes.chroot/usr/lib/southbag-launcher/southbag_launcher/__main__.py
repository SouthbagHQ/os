"""CLI entry points for the OS worker's unit files.

  python3 -m southbag_launcher setup --manifest PATH [--dropin PATH]
                                     [--runtime-dir PATH]
  python3 -m southbag_launcher run   --manifest PATH [--uid N --gid N]
                                     [--runtime-dir PATH]
                                     -- /absolute/worker [args...]
  python3 -m southbag_launcher validate --manifest PATH

`setup` runs at boot as root (discovery + manifest + drop-in render).
`run` is the worker unit's ExecStart (validate -> monitor -> open ->
spawn -> supervise). `validate` is a dry check for CI.
"""

import argparse
import grp
import pwd
import sys

from .errors import Deny, MonitorTerminal
from .launcher import (EXIT_CLEAN, EXIT_DENY, EXIT_TERMINAL, Launcher,
                       run_setup)
from .manifest import load_and_validate, FileStore
from .sysfsio import DeviceIO


def _resolve_user(name_or_uid):
    try:
        return int(name_or_uid)
    except ValueError:
        return pwd.getpwnam(name_or_uid).pw_uid


def _resolve_group(name_or_gid):
    try:
        return int(name_or_gid)
    except ValueError:
        return grp.getgrnam(name_or_gid).gr_gid


def main(argv=None):
    parser = argparse.ArgumentParser(prog="southbag-launcher")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_setup = sub.add_parser("setup", help="boot-time discovery + manifest")
    p_setup.add_argument("--manifest", required=True)
    p_setup.add_argument("--dropin", default=None)
    p_setup.add_argument("--runtime-dir", default="/run/southbag/kevin")

    p_run = sub.add_parser("run", help="validate, open, spawn, supervise")
    p_run.add_argument("--manifest", required=True)
    p_run.add_argument("--runtime-dir", default="/run/southbag/kevin")
    p_run.add_argument("--uid", default=None,
                       help="dedicated UID (name or number) for the worker child")
    p_run.add_argument("--gid", default=None,
                       help="dedicated GID (name or number) for the worker child")
    p_run.add_argument("--snapshot-interval", type=float, default=5.0)
    p_run.add_argument("--term-timeout", type=float, default=3.0)
    p_run.add_argument("--kill-timeout", type=float, default=3.0)
    p_run.add_argument("worker", nargs=argparse.REMAINDER,
                       help="-- /absolute/worker [args...]")

    p_val = sub.add_parser("validate", help="manifest dry check (CI)")
    p_val.add_argument("--manifest", required=True)

    args = parser.parse_args(argv)

    try:
        if args.cmd == "setup":
            manifest, dropin = run_setup({
                "manifest_path": args.manifest,
                "dropin_path": args.dropin,
                "runtime_dir": args.runtime_dir,
            })
            sys.stderr.write(
                "southbag setup: %d physical keyboard(s) admitted\n"
                % len(manifest["devices"]))
            return EXIT_CLEAN

        if args.cmd == "validate":
            manifest = load_and_validate(FileStore(), DeviceIO(), args.manifest)
            sys.stderr.write("southbag validate: manifest OK, %d device(s)\n"
                             % len(manifest["devices"]))
            return EXIT_CLEAN

        worker_argv = list(args.worker)
        if worker_argv and worker_argv[0] == "--":
            worker_argv = worker_argv[1:]
        if not worker_argv:
            raise Deny("no worker argv given (use -- /absolute/worker ...)")
        uid = _resolve_user(args.uid) if args.uid else None
        gid = _resolve_group(args.gid) if args.gid else None
        if (uid is None) != (gid is None):
            raise Deny("--uid and --gid must be given together")
        launcher = Launcher({
            "manifest_path": args.manifest,
            "runtime_dir": args.runtime_dir,
            "worker_argv": worker_argv,
            "uid": uid,
            "gid": gid,
            "snapshot_interval": args.snapshot_interval,
            "term_timeout": args.term_timeout,
            "kill_timeout": args.kill_timeout,
        })
        return launcher.run()

    except Deny as exc:
        sys.stderr.write("southbag launcher: DENIED: %s\n" % exc)
        return EXIT_DENY
    except MonitorTerminal as exc:
        sys.stderr.write("southbag launcher: TERMINAL: %s\n" % exc)
        return EXIT_TERMINAL


if __name__ == "__main__":
    sys.exit(main())
