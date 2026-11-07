#!/bin/sh
set -eu
# Disposable guest only. Candidate is a supplied file, never installed over
# the dormant broker. Only the separately named sleep unit is started.
[ "$(id -u)" = 0 ] || exit 2
candidate=$(realpath "${1:?Usage: broker-deadline.sh CANDIDATE_BROKER}")
export SYSTEMD_PAGER=cat SYSTEMD_COLORS=0
if systemctl cat southbag-stop-qualification.service >/dev/null 2>&1; then exit 2; fi
export SYSTEMD_PAGER=cat SYSTEMD_COLORS=0
unit=southbag-stop-qualification.service
cleanup() { systemctl kill --signal=KILL "$unit" >/dev/null 2>&1 || true; systemctl stop "$unit" >/dev/null 2>&1 || true; rm -f /run/systemd/system/"$unit"; systemctl daemon-reload; }
trap cleanup EXIT
systemctl show southbag-espanso.service -p MainPID -p ActiveState
systemctl cat southbag-espanso.service | grep '^ExecCondition=/bin/false$'
mkdir -p /tmp/stopqual-state; echo 7 >/tmp/stopqual-state/generation
export SOUTHBAG_BROKER_UNIT="$unit" SOUTHBAG_BROKER_STATE=/tmp/stopqual-state SOUTHBAG_BROKER_STOP_DEADLINE=8
cat >/run/systemd/system/"$unit" <<'UNIT'
[Service]
ExecStart=/bin/sh -c 'sleep infinity & wait'
KillMode=control-group
PrivateDevices=yes
NoNewPrivileges=yes
TimeoutStopSec=1
UNIT
systemctl daemon-reload
systemctl start "$unit"
cg=$(systemctl show "$unit" -p ControlGroup --value)
cat "/sys/fs/cgroup$cg/cgroup.events"
sh "$candidate" inhibit 7
[ "$(cat /tmp/stopqual-state/state)" = inhibited ]
[ "$(systemctl show "$unit" -p MainPID --value)" = 0 ]
if [ -e "/sys/fs/cgroup$cg/cgroup.events" ]; then grep '^populated 0$' "/sys/fs/cgroup$cg/cgroup.events"; else echo INERT_CGROUP_REMOVED; fi
echo REAL_INERT_STOP_PASS
cat >/tmp/hung-status <<'ADAPTER'
#!/bin/sh
[ "$1" = is-active ] && { sleep 30; exit 3; }
exec /bin/systemctl "$@"
ADAPTER
chmod 700 /tmp/hung-status
t0=$(cut -d. -f1 /proc/uptime)
if SOUTHBAG_BROKER_SYSTEMCTL=/tmp/hung-status sh "$candidate" inhibit 7; then exit 1; fi
dt=$(( $(cut -d. -f1 /proc/uptime) - t0 ))
[ "$dt" -le 11 ]; [ "$(cat /tmp/stopqual-state/state)" = failed ]
echo REAL_HOST_HUNG_PROBE_FAIL_CLOSED elapsed=$dt
sh "$candidate" inhibit 7
[ "$(cat /tmp/stopqual-state/state)" = inhibited ]
echo REAL_HOST_EXPLICIT_RECOVERY_PASS
cleanup
trap - EXIT
echo INERT_DEADLINE_BASIC_DONE

unit=southbag-stop-qualification.service
export SOUTHBAG_BROKER_UNIT=$unit SOUTHBAG_BROKER_STATE=/tmp/stopqual-state SOUTHBAG_BROKER_STOP_DEADLINE=8
cleanup(){ systemctl kill --signal=KILL "$unit" >/dev/null 2>&1 || true; systemctl stop "$unit" >/dev/null 2>&1 || true; rm -f /run/systemd/system/"$unit"; systemctl daemon-reload; }
trap cleanup EXIT
cat >/run/systemd/system/$unit <<'UNIT'
[Service]
ExecStart=/bin/sleep infinity
PrivateDevices=yes
NoNewPrivileges=yes
UNIT
systemctl daemon-reload
rm -f /tmp/stopqual-count
cat >/tmp/reappear-status <<'ADAPTER'
#!/bin/sh
if [ "$1" = is-active ]; then
 n=$(cat /tmp/stopqual-count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" >/tmp/stopqual-count
 [ "$n" = 2 ] && /bin/systemctl start southbag-stop-qualification.service
fi
exec /bin/systemctl "$@"
ADAPTER
chmod 700 /tmp/reappear-status
if SOUTHBAG_BROKER_SYSTEMCTL=/tmp/reappear-status sh "$candidate" inhibit 7; then exit 1; fi
[ "$(cat /tmp/stopqual-state/state)" = failed ]
systemctl is-active --quiet "$unit"
echo REAL_INERT_REAPPEAR_DENIED
systemctl stop "$unit"
cat >/run/systemd/system/$unit <<'UNIT'
[Service]
ExecStart=/bin/sleep infinity
ExecStop=/bin/sleep 30
TimeoutStopSec=35
PrivateDevices=yes
NoNewPrivileges=yes
KillMode=control-group
UNIT
systemctl daemon-reload
systemctl start "$unit"
t0=$(cut -d. -f1 /proc/uptime)
if sh "$candidate" inhibit 7; then exit 1; fi
dt=$(( $(cut -d. -f1 /proc/uptime) - t0 ))
[ "$dt" -le 11 ]; [ "$(cat /tmp/stopqual-state/state)" = failed ]
echo REAL_INERT_HUNG_STOP_FAIL_CLOSED elapsed=$dt
cleanup
trap - EXIT
systemctl show southbag-espanso.service -p MainPID -p ActiveState
echo INERT_DEADLINE_ALL_DONE
