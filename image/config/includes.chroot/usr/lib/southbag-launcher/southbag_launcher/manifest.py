"""Root-only immutable generation manifest.

The boot-time setup step (root) discovers physical keyboards and writes
the manifest atomically with mode 0400 in a 0700 root-owned directory.
The launcher validates it before every start:

* opened with O_NOFOLLOW, must be a regular file owned by uid 0 with no
  group/other permission bits;
* format and digest must verify;
* every device entry must re-validate against live sysfs ancestry,
  capability ioctls, and opened-FD fstat data.

Event names alone never establish identity.
"""

import hashlib
import json
import os
import re
import secrets
import stat as statmod

from . import evdev, sysfsio
from .errors import Deny

FORMAT = 1
MANIFEST_MODE = 0o400
RUNTIME_DIR_MODE = 0o700

TOKEN_RE = re.compile(r"^[A-Za-z0-9._:-]+$")


def canonical_json(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def manifest_digest(devices):
    return "sha256:" + hashlib.sha256(canonical_json(devices).encode()).hexdigest()


def token_for(sysfs_realpath):
    """Broker's opaque device identity token, charset per contract v4."""
    token = re.sub(r"[^A-Za-z0-9._:-]", "-", sysfs_realpath.lstrip("/"))
    if not TOKEN_RE.match(token):
        raise Deny("cannot derive a contract-legal token from %s" % sysfs_realpath)
    return token


def new_generation(previous=None):
    """Decimal u64 > 0. A restart always gets a new generation; an
    accidental repeat of the previous one is denied, never reused."""
    for _ in range(3):
        gen = secrets.randbelow(2**63 - 1) + 1
        if gen != previous:
            return gen
    raise Deny("could not mint a fresh generation")


# ---------------------------------------------------------------------------
# File seam: keeps the owner/mode checks testable without root.
# ---------------------------------------------------------------------------

class FileStore:
    """Real filesystem manifest store."""

    def read_rootonly(self, path):
        """Open O_RDONLY|O_NOFOLLOW|O_CLOEXEC and enforce root-only."""
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except OSError as exc:
            raise Deny("manifest open failed (%s): %s" % (path, exc))
        try:
            st = os.fstat(fd)
            enforce_rootonly_stat(path, st)
            with os.fdopen(os.dup(fd), "rb") as fh:
                return fh.read()
        finally:
            os.close(fd)

    def write_atomic_rootonly(self, path, data: bytes):
        """0600 tempfile -> fsync -> chmod 0400 -> atomic rename -> dir fsync."""
        directory = os.path.dirname(path)
        os.makedirs(directory, mode=RUNTIME_DIR_MODE, exist_ok=True)
        os.chmod(directory, RUNTIME_DIR_MODE)
        tmp = path + ".tmp.%d" % os.getpid()
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, MANIFEST_MODE)
            os.rename(tmp, path)
            dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def enforce_rootonly_stat(path, st):
    if not statmod.S_ISREG(st.st_mode):
        raise Deny("manifest is not a regular file: %s" % path)
    if st.st_uid != 0:
        raise Deny("manifest not owned by root: %s (uid=%d)" % (path, st.st_uid))
    if st.st_mode & 0o077:
        raise Deny("manifest has group/other permission bits: %s" % path)


# ---------------------------------------------------------------------------
# Build (boot-time setup, runs as root)
# ---------------------------------------------------------------------------

def build_manifest(io, previous_generation=None):
    """Discover current non-virtual physical keyboards.

    Missing or ambiguous state denies startup: discovery errors propagate
    as Deny, and zero admitted devices is a Deny, not an empty manifest.
    """
    devices = []
    seen = set()
    for event_name in sysfsio.enumerate_event_names(io):
        desc = sysfsio.describe_event(io, event_name)
        if desc is None:
            continue  # virtual or non-keyboard: normal skip
        identity = (desc["dev"], desc["sysfs_realpath"], desc["name"])
        if identity in seen:
            raise Deny("duplicate device identity during discovery: %r" % (identity,))
        seen.add(identity)
        desc["token"] = token_for(desc["sysfs_realpath"])
        devices.append(desc)
    if not devices:
        raise Deny("no physical keyboards discovered; denying startup")
    manifest = {
        "format": FORMAT,
        "generation_seed": new_generation(previous_generation),
        "devices": devices,
        "uinput": {
            "path": "/dev/uinput",
            "major": evdev.MISC_MAJOR,
            "minor": evdev.UINPUT_MINOR,
        },
    }
    manifest["digest"] = manifest_digest(devices)
    return manifest


def serialize(manifest):
    return (canonical_json(manifest) + "\n").encode()


# ---------------------------------------------------------------------------
# Load + validate (launch time)
# ---------------------------------------------------------------------------

def load_and_validate(store, io, path):
    raw = store.read_rootonly(path)
    try:
        manifest = json.loads(raw.decode())
    except (ValueError, UnicodeDecodeError) as exc:
        raise Deny("manifest is not valid JSON: %s" % exc)
    if manifest.get("format") != FORMAT:
        raise Deny("unsupported manifest format: %r" % manifest.get("format"))
    devices = manifest.get("devices")
    if not isinstance(devices, list) or not devices:
        raise Deny("manifest has no devices")
    if manifest.get("digest") != manifest_digest(devices):
        raise Deny("manifest digest mismatch")
    tokens = [d.get("token", "") for d in devices]
    if any(not TOKEN_RE.match(t) for t in tokens):
        raise Deny("manifest contains a contract-illegal token")
    if len(set(tokens)) != len(tokens):
        raise Deny("manifest contains duplicate tokens")
    devs = [d.get("dev") for d in devices]
    if len(set(devs)) != len(devs):
        raise Deny("manifest contains duplicate device numbers")
    uinput = manifest.get("uinput") or {}
    if uinput.get("major") != evdev.MISC_MAJOR or uinput.get("minor") != evdev.UINPUT_MINOR:
        raise Deny("manifest uinput identity mismatch")
    return manifest


def validate_opened_device(io, entry):
    """Open one manifest device and prove the fd IS that device.

    Returns the open fd (O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC).
    Raises Deny on any mismatch: sysfs realpath drift, dev-number drift,
    fstat mismatch, name change, capability change, or lost physical
    ancestry.
    """
    node = entry["event_node"]
    event_name = entry["event_name"]
    cpath = sysfsio.class_path(io, event_name)
    realpath = io.realpath(cpath)
    if realpath != entry["sysfs_realpath"]:
        raise Deny("sysfs realpath drift for %s: %s != %s"
                   % (event_name, realpath, entry["sysfs_realpath"]))
    ok, reason = sysfsio.physical_evidence(io, realpath)
    if not ok:
        raise Deny("physical ancestry lost for %s: %s" % (event_name, reason))
    try:
        sysfs_dev = io.read_text(realpath + "/dev")
    except OSError as exc:
        raise Deny("sysfs dev read failed for %s: %s" % (event_name, exc))
    if sysfs_dev != entry["dev"]:
        raise Deny("sysfs dev drift for %s" % event_name)

    try:
        fd = io.open(node, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError as exc:
        raise Deny("open failed for %s: %s" % (node, exc))
    try:
        st = io.fstat(fd)
        if not evdev.is_char_device_with_rdev(st.st_mode, st.st_rdev, evdev.INPUT_MAJOR):
            raise Deny("opened %s is not an input char device" % node)
        if "%d:%d" % (os.major(st.st_rdev), os.minor(st.st_rdev)) != entry["dev"]:
            raise Deny("opened-FD dev mismatch for %s (fstat vs manifest)" % node)
        if io.ioctl_name(fd) != entry["name"]:
            raise Deny("device name changed for %s" % node)
        ev_bits = io.ioctl_ev_bits(fd)
        key_bits = io.ioctl_key_bits(fd)
        if not evdev.looks_like_keyboard(ev_bits, key_bits):
            raise Deny("device no longer qualifies as a keyboard: %s" % node)
        if evdev.capability_digest(ev_bits, key_bits) != entry["capability_digest"]:
            raise Deny("capability digest changed for %s" % node)
        if io.ioctl_input_id(fd) != entry["input_id"]:
            raise Deny("input_id changed for %s" % node)
        fl = _fd_status_flags(io, fd)
        if not fl & os.O_NONBLOCK:
            raise Deny("opened grant fd lost O_NONBLOCK for %s" % node)
    except Deny:
        io.close(fd)
        raise
    except OSError as exc:
        io.close(fd)
        raise Deny("device identity check failed for %s: %s" % (node, exc))
    return fd


def open_uinput(io, entry):
    path = entry["path"]
    try:
        fd = io.open(path, os.O_WRONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError as exc:
        raise Deny("open failed for %s: %s" % (path, exc))
    try:
        st = io.fstat(fd)
        if not evdev.is_char_device_with_rdev(
            st.st_mode, st.st_rdev, evdev.MISC_MAJOR, evdev.UINPUT_MINOR
        ):
            raise Deny("%s is not the uinput char device" % path)
        fl = _fd_status_flags(io, fd)
        if not fl & os.O_NONBLOCK:
            raise Deny("uinput fd lost O_NONBLOCK")
    except Deny:
        io.close(fd)
        raise
    except OSError as exc:
        io.close(fd)
        raise Deny("uinput identity check failed: %s" % exc)
    return fd


def _fd_status_flags(io, fd):
    getfl = getattr(io, "fd_status_flags", None)
    if getfl is not None:
        return getfl(fd)
    import fcntl
    return fcntl.fcntl(fd, fcntl.F_GETFL)


# ---------------------------------------------------------------------------
# Topology snapshot (monitor baseline + open-transaction TOCTOU check)
# ---------------------------------------------------------------------------

def snapshot_topology(io):
    """Frozen identity of every currently present physical keyboard.

    Used twice around the open transaction (before the first open and
    after the last) and as the monitor's baseline for periodic rechecks.
    Any difference is fail-closed.
    """
    rows = []
    for event_name in sysfsio.enumerate_event_names(io):
        cpath = sysfsio.class_path(io, event_name)
        realpath = io.realpath(cpath)
        ok, _ = sysfsio.physical_evidence(io, realpath)
        if not ok:
            continue
        try:
            dev = io.read_text(realpath + "/dev")
        except OSError:
            raise Deny("topology snapshot read failed for %s" % event_name)
        device_realpath = io.realpath(cpath + "/device")
        name = sysfsio._read_optional(io, device_realpath + "/name")
        rows.append((event_name, realpath, dev, name))
    return tuple(sorted(rows))
