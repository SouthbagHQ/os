"""Manifest build/validate fail-closed tests. No hardware: FakeIO scripts
sysfs, nodes, ioctls; FakeFileStore scripts ownership."""

import os

import pytest

from southbag_launcher import evdev
from southbag_launcher.errors import Deny
from southbag_launcher import manifest as m
from southbag_launcher.manifest import FileStore

from fakes import (FakeFileStore, FakeIO, keyboard_bits, nonkeyboard_bits)


def build_fake(**kb):
    io = FakeIO()
    io.add_keyboard(**kb)
    return io


def build_and_store(io):
    manifest = m.build_manifest(io)
    return manifest, FakeFileStore(content=m.serialize(manifest))


# -- build ------------------------------------------------------------------

def test_build_admits_physical_keyboard():
    io = build_fake()
    manifest = m.build_manifest(io)
    assert len(manifest["devices"]) == 1
    d = manifest["devices"][0]
    assert d["event_node"] == "/dev/input/event3"
    assert m.TOKEN_RE.match(d["token"])
    assert manifest["digest"] == m.manifest_digest(manifest["devices"])


def test_build_skips_virtual_and_nonkeyboard():
    io = build_fake()
    io.add_keyboard(event_name="event9", name="Espanso virtual device",
                    virtual=True, dev="13:99")
    io.add_keyboard(event_name="event10", name="Power Button", dev="13:98",
                    bits=nonkeyboard_bits())
    manifest = m.build_manifest(io)
    assert [d["event_name"] for d in manifest["devices"]] == ["event3"]


def test_build_denies_zero_keyboards():
    io = FakeIO()
    io.add_keyboard(event_name="event9", name="virtual kbd", virtual=True,
                    dev="13:99")
    with pytest.raises(Deny, match="no physical keyboards"):
        m.build_manifest(io)


def test_build_denies_ambiguous_ancestry():
    io = FakeIO()
    io.add_keyboard(bus_bound=False)  # no driver/subsystem ancestor
    with pytest.raises(Deny, match="missing or ambiguous physical evidence"):
        m.build_manifest(io)


def test_mixed_valid_plus_ambiguous_keyboard_like_denies():
    # The integrator's case: one valid keyboard plus a keyboard-CAPABLE
    # entry with ambiguous ancestry. Starting with just the valid one
    # would silently shrink the approved set - deny.
    io = FakeIO()
    io.add_keyboard(event_name="event3", dev="13:67")  # valid, bus-bound
    io.add_keyboard(event_name="event4", dev="13:68", bus_bound=False)
    with pytest.raises(Deny, match="missing or ambiguous physical evidence"):
        m.build_manifest(io)


def test_mixed_valid_plus_ambiguous_plus_virtual_denies():
    io = FakeIO()
    io.add_keyboard(event_name="event3", dev="13:67")
    io.add_keyboard(event_name="event4", dev="13:68", bus_bound=False)
    io.add_keyboard(event_name="event9", name="Espanso virtual device",
                    virtual=True, dev="13:99")  # expected skip
    with pytest.raises(Deny, match="missing or ambiguous physical evidence"):
        m.build_manifest(io)


def test_mixed_valid_plus_ambiguous_nonkeyboard_admits_valid_only():
    # Not broadly denied: an entry that is capability-PROVEN non-keyboard
    # (power button) is an expected skip even with ambiguous ancestry -
    # it cannot be a keystroke source, so the set is complete.
    io = FakeIO()
    io.add_keyboard(event_name="event3", dev="13:67")
    io.add_keyboard(event_name="event4", dev="13:68", bus_bound=False,
                    bits=nonkeyboard_bits(), name="Power Button")
    manifest = m.build_manifest(io)
    assert [d["event_name"] for d in manifest["devices"]] == ["event3"]


def test_discovery_denies_sysfs_vanish():
    io = build_fake()
    orig_exists = io.exists
    target = io.devices["event3"].realpath
    io.exists = lambda p: False if p == target else orig_exists(p)
    with pytest.raises(Deny, match="vanished"):
        m.build_manifest(io)


def test_discovery_denies_capability_error():
    io = build_fake()
    io.fail_ioctl.add("event3")
    with pytest.raises(Deny, match="capability read failed"):
        m.build_manifest(io)


def test_generation_is_positive_u64_and_fresh():
    g1 = m.new_generation()
    g2 = m.new_generation(previous=g1)
    assert 0 < g1 < 2**64
    assert g2 != g1


# -- load + validate ----------------------------------------------------------

def test_load_roundtrip():
    io = build_fake()
    manifest, store = build_and_store(io)
    loaded = m.load_and_validate(store, io, "/run/southbag/kevin/manifest.json")
    assert loaded == manifest


def test_load_denies_non_root_owner():
    io = build_fake()
    manifest = m.build_manifest(io)
    store = FakeFileStore(content=m.serialize(manifest), uid=1000)
    with pytest.raises(Deny, match="owned by root"):
        m.load_and_validate(store, io, "p")


def test_load_denies_group_other_bits():
    io = build_fake()
    manifest = m.build_manifest(io)
    store = FakeFileStore(content=m.serialize(manifest), mode=0o440)
    with pytest.raises(Deny, match="permission bits"):
        m.load_and_validate(store, io, "p")


def test_load_denies_symlink():
    io = build_fake()
    manifest = m.build_manifest(io)
    store = FakeFileStore(content=m.serialize(manifest), symlink=True)
    with pytest.raises(Deny, match="symbolic links"):
        m.load_and_validate(store, io, "p")


def test_load_denies_digest_tamper():
    io = build_fake()
    manifest = m.build_manifest(io)
    manifest["devices"][0]["name"] = "Forged Name"
    store = FakeFileStore(content=m.serialize(manifest))
    with pytest.raises(Deny, match="digest"):
        m.load_and_validate(store, io, "p")


def test_load_denies_duplicate_tokens():
    io = build_fake()
    manifest = m.build_manifest(io)
    dup = dict(manifest["devices"][0])
    dup["event_node"] = "/dev/input/event4"
    dup["event_name"] = "event4"
    dup["dev"] = "13:68"
    manifest["devices"].append(dup)  # same token twice
    manifest["digest"] = m.manifest_digest(manifest["devices"])
    store = FakeFileStore(content=m.serialize(manifest))
    with pytest.raises(Deny, match="duplicate tokens"):
        m.load_and_validate(store, io, "p")


# -- per-device open validation -------------------------------------------------

def _entry(io):
    manifest = m.build_manifest(io)
    return manifest["devices"][0]


def test_validate_opened_device_happy():
    io = build_fake()
    fd = m.validate_opened_device(io, _entry(io))
    try:
        assert io.fd_status_flags(fd) & os.O_NONBLOCK
    finally:
        io.close(fd)


def test_validate_denies_missing_device():
    io = build_fake()
    entry = _entry(io)
    io.remove_device("event3")
    with pytest.raises(Deny):
        m.validate_opened_device(io, entry)


def test_validate_denies_symlink_swap():
    io = build_fake()
    entry = _entry(io)
    io.swap_node_symlink("event3", "/dev/input/event3")
    with pytest.raises(Deny, match="too many levels|symlink"):
        m.validate_opened_device(io, entry)


def test_validate_denies_sysfs_realpath_drift():
    io = build_fake()
    entry = _entry(io)
    io.rp["/sys/class/input/event3"] = entry["sysfs_realpath"] + "-moved"
    # Keep the moved path looking physical so the drift check itself fires.
    with pytest.raises(Deny, match="realpath drift"):
        m.validate_opened_device(io, entry)


def test_validate_denies_capability_error():
    io = build_fake()
    entry = _entry(io)
    io.fail_ioctl.add("event3")
    with pytest.raises(Deny, match="identity check failed"):
        m.validate_opened_device(io, entry)


def test_validate_denies_capability_change():
    io = build_fake()
    entry = _entry(io)
    ev_bits, key_bits = keyboard_bits()
    # Drop KEY_SPACE after the manifest was recorded.
    kb = bytearray(key_bits)
    kb[evdev.KEY_SPACE // 8] &= ~(1 << (evdev.KEY_SPACE % 8))
    io.devices["event3"].key_bits = bytes(kb)
    with pytest.raises(Deny, match="no longer qualifies"):
        m.validate_opened_device(io, entry)


def test_validate_denies_name_change():
    io = build_fake()
    entry = _entry(io)
    io.devices["event3"].name = "Swapped Keyboard"
    with pytest.raises(Deny, match="name changed"):
        m.validate_opened_device(io, entry)


def test_validate_denies_virtual_ancestry_swap():
    io = build_fake()
    entry = _entry(io)
    # Attacker re-points the sysfs class entry at a virtual device with an
    # identical name/dev. Ancestry check must catch it.
    io.rp["/sys/class/input/event3"] = entry["sysfs_realpath"]  # keep drift quiet
    d = io.devices["event3"]
    d.driver_ancestors = ()
    d.subsystem_ancestors = ()
    d.realpath = "/sys/devices/virtual/input/input99/event3"
    io.rp["/sys/class/input/event3"] = d.realpath
    entry = dict(entry, sysfs_realpath=d.realpath)
    with pytest.raises(Deny, match="virtual ancestry|physical ancestry lost"):
        m.validate_opened_device(io, entry)


def test_open_uinput_happy_and_wrong_minor():
    io = build_fake()
    uentry = {"path": "/dev/uinput", "major": evdev.MISC_MAJOR,
              "minor": evdev.UINPUT_MINOR}
    fd = m.open_uinput(io, uentry)
    try:
        assert io.fd_status_flags(fd) & os.O_NONBLOCK
    finally:
        io.close(fd)
    io.uinput_present = False
    with pytest.raises(Deny, match="open failed"):
        m.open_uinput(io, uentry)


# -- real-filesystem store behavior --------------------------------------------

def test_real_store_writes_0400_atomic(tmp_path):
    store = FileStore()
    path = str(tmp_path / "sub" / "manifest.json")
    store.write_atomic_rootonly(path, b"{}")
    st = os.stat(path)
    assert st.st_mode & 0o777 == 0o400
    assert open(path, "rb").read() == b"{}"
    assert os.stat(os.path.dirname(path)).st_mode & 0o777 == 0o700


def test_real_store_denies_non_root_file(tmp_path):
    store = FileStore()
    path = str(tmp_path / "manifest.json")
    with open(path, "w") as fh:
        fh.write("{}")
    os.chmod(path, 0o400)
    if os.geteuid() != 0:
        with pytest.raises(Deny, match="owned by root"):
            store.read_rootonly(path)


# -- topology snapshot -----------------------------------------------------------

def test_snapshot_stable_and_detects_removal():
    io = build_fake()
    a = m.snapshot_topology(io)
    assert m.snapshot_topology(io) == a
    io.remove_device("event3")
    assert m.snapshot_topology(io) != a
