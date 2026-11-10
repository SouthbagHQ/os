#!/bin/sh
set -u
[ "$(id -u)" = 0 ] || exit 2
# Refuse to overwrite an installed worker. Disposable image only.
if systemctl cat southbag-espanso.service >/dev/null 2>&1; then exit 2; fi
export SYSTEMD_PAGER=cat SYSTEMD_COLORS=0
client=/usr/local/bin/southbag-input-client
gen=$(/usr/local/sbin/southbag-input-broker current | sed -n 's/^generation=\([1-9][0-9]*\) state=inhibited$/\1/p')
[ -n "$gen" ] || exit 2
cleanup() {
 systemctl kill --signal=KILL southbag-espanso.service >/dev/null 2>&1 || true
 systemctl stop southbag-espanso.service >/dev/null 2>&1 || true
 rm -f /run/systemd/system/southbag-espanso.service
 systemctl daemon-reload
}
trap cleanup EXIT
cat >/run/systemd/system/southbag-espanso.service <<'UNIT'
[Unit]
Description=INERT disposable stop-barrier test, not an input worker
[Service]
ExecStart=/bin/sleep infinity
NoNewPrivileges=yes
PrivateDevices=yes
UNIT
systemctl daemon-reload
printf 'LIFECYCLE_BEGIN\n' 
systemctl start southbag-espanso.service
cat /sys/fs/cgroup/system.slice/southbag-espanso.service/cgroup.events
runuser -u customer -- "$client" inhibit "$gen"; echo STOP_RC=$?
if [ -e /sys/fs/cgroup/system.slice/southbag-espanso.service/cgroup.events ]; then cat /sys/fs/cgroup/system.slice/southbag-espanso.service/cgroup.events; else echo STOP_CGROUP_REMOVED; fi
mkdir -p /tmp/lock-boundary; printf 'inert-fixture\n' >/tmp/lock-boundary/account; chown -R customer:customer /tmp/lock-boundary
runuser -u customer -- env SOUTHBAG_STATE_DIR=/tmp/lock-boundary SOUTHBAG_LOCK_SURFACE=/bin/true /usr/local/bin/southbag-lock; echo LOCK_BARRIER_RC=$?
test -e /tmp/lock-boundary/locked; echo LOCKED_FLAG_RC=$?
rm -f /tmp/lock-boundary/locked
systemctl stop southbag-input-broker.socket
runuser -u customer -- env SOUTHBAG_STATE_DIR=/tmp/lock-boundary SOUTHBAG_LOCK_SURFACE=/bin/true /usr/local/bin/southbag-lock; echo MISSING_SOCKET_LOCK_RC=$?
test ! -e /tmp/lock-boundary/locked; echo MISSING_SOCKET_NO_FLAG_RC=$?
systemctl start southbag-input-broker.socket
cat >/run/systemd/system/southbag-espanso.service <<'UNIT'
[Unit]
Description=INERT stop timeout fixture, no input access
[Service]
ExecStart=/bin/sleep infinity
ExecStop=/bin/sleep 120
TimeoutStopSec=130
NoNewPrivileges=yes
PrivateDevices=yes
UNIT
systemctl daemon-reload
systemctl start southbag-espanso.service
t0=$(date +%s)
runuser -u customer -- "$client" inhibit "$gen"; rc=$?
echo HUNG_STOP_RC=$rc ELAPSED=$(( $(date +%s)-t0 ))
cat /run/southbag-input-broker/state
cat /sys/fs/cgroup/system.slice/southbag-espanso.service/cgroup.events
systemctl kill --signal=KILL southbag-espanso.service
systemctl stop southbag-espanso.service
runuser -u customer -- "$client" inhibit "$gen"; echo RECOVER_INHIBIT_RC=$?
cat /run/southbag-input-broker/state
rm /run/systemd/system/southbag-espanso.service
systemctl daemon-reload
stat -c '%U:%G %a %n' /run/southbag-input-broker /run/southbag-input-broker/*
echo SB_COMMAND_DONE
