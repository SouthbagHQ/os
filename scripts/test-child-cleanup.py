#!/usr/bin/env python3
"""Linux test runner with cleanup confined to adopted test descendants.

No process-name matching, no production services or cgroup changes. Existing
fixtures intentionally abandon sleepers during stop-failure tests. Report them
and clean only children adopted by this invocation's subreaper. Test failures
remain failures; cleanup uncertainty is a failure too.
"""
import ctypes
import os
import pathlib
import signal
import subprocess
import sys
import time


def adopted():
    rows = []
    for path in pathlib.Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            stat = (path / 'stat').read_text()
            fields = stat[stat.rfind(')') + 2:].split()
            if int(fields[1]) == os.getpid():
                rows.append((int(path.name), fields[0]))
        except (OSError, ValueError):
            continue
    return rows


def cleanup():
    count = 0
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        # Grandchildren can be adopted only after their immediate parent dies.
        # Re-scan until every descendant has been killed and reaped.
        rows = adopted()
        for pid, state in rows:
            if state != 'Z':
                try:
                    # Bind the kill to a process handle, then re-check adoption
                    # to avoid signaling an unrelated reused PID.
                    fd = os.pidfd_open(pid)
                    try:
                        if (pid, state) in adopted():
                            signal.pidfd_send_signal(fd, signal.SIGKILL)
                            count += 1
                    finally:
                        os.close(fd)
                except ProcessLookupError:
                    pass
        try:
            while os.waitpid(-1, os.WNOHANG)[0]:
                pass
        except ChildProcessError:
            print('TEST_CHILD_CLEANUP live_killed=%d remaining=0' % count, flush=True)
            return True
        time.sleep(0.05)
    print('TEST_CHILD_CLEANUP_UNVERIFIED remaining=%r' % adopted(), file=sys.stderr)
    return False


def main(argv):
    if not argv:
        raise SystemExit('Usage: test-child-cleanup.py COMMAND [ARGS...]')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0):  # PR_SET_CHILD_SUBREAPER, this process only
        raise OSError(ctypes.get_errno(), 'cannot establish scoped test cleanup')
    child = subprocess.Popen(argv)
    try:
        result = child.wait()
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        clean = cleanup()
    return result if clean and result >= 0 else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
