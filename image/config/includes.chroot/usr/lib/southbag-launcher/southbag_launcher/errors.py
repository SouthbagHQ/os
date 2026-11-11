"""Failure taxonomy for the launcher.

Every uncertainty is a Deny (pre-start) or a TerminalLoss (post-start).
Both are fail-closed: the worker is never started on a Deny, and a
TerminalLoss stops the unit without restart or rearm.
"""


class Deny(Exception):
    """Admission failure before or during the open transaction.

    Raised for: missing or ambiguous physical device state, manifest
    validation failures, capability errors, symlink/identity swaps,
    duplicate identities, and topology changes observed between the
    pre-open and post-open snapshots.
    """


class MonitorTerminal(Exception):
    """Topology/monitor uncertainty observed after startup.

    Raised for: uevent sequence gaps, truncated or overflowing reads,
    malformed datagrams, socket read failures, add/remove/change of any
    approved device, any non-synthetic virtual input event, any other
    physical input topology change, or a snapshot recheck mismatch.
    """


class CleanupIncomplete(Exception):
    """Bounded cleanup could not verify an empty descendant set.

    Reported upward; the stop broker (systemd) still owns the final
    cgroup-empty verification.
    """
