#!/bin/sh
# Disposable networkless root guest, inert processes/regular file only.
# Refuse an installed worker: never replace a shipped worker unit.
set -eu
[ "$(id -u)" = 0 ] || exit 2
if systemctl cat southbag-espanso.service >/dev/null 2>&1; then exit 2; fi
base=$(mktemp -d /run/broker-inert-tree.XXXXXX)
cleanup() {
 systemctl kill --signal=KILL southbag-espanso.service >/dev/null 2>&1 || true
 systemctl stop southbag-espanso.service >/dev/null 2>&1 || true
 rm -f /run/systemd/system/southbag-espanso.service
 systemctl daemon-reload
 rm -rf "$base"
}
trap cleanup EXIT HUP INT TERM
client=/usr/local/bin/southbag-input-client
gen=$(/usr/local/sbin/southbag-input-broker current | sed -n 's/^generation=\([1-9][0-9]*\) state=inhibited$/\1/p')
[ -n "$gen" ] || exit 2
printf 'INERT regular-file descriptor target\n' >"$base/target"
cat >"$base/tree" <<'TREE'
#!/bin/sh
base=$1; role=$2
exec 9<"$base/target"
printf '%s\n' "$$" >"$base/$role.pid"
case $role in
 parent) sh "$base/tree" "$base" child & ;;
 child) sh "$base/tree" "$base" grandchild & ;;
esac
trap '' TERM
while :; do sleep 1; done
TREE
cat >/run/systemd/system/southbag-espanso.service <<UNIT
[Unit]
Description=INERT descendant and regular-file FD barrier test
[Service]
ExecStart=/bin/sh $base/tree $base parent
KillMode=control-group
TimeoutStopSec=2
SendSIGKILL=yes
NoNewPrivileges=yes
PrivateDevices=yes
PrivateNetwork=yes
UNIT
systemctl daemon-reload
systemctl start southbag-espanso.service
for i in $(seq 1 100); do
 [ ! -f "$base/grandchild.pid" ] || break
 sleep .1
done
cg=$(systemctl show southbag-espanso.service -p ControlGroup --value)
[ -n "$cg" ]
cat "/sys/fs/cgroup$cg/cgroup.events"
for role in parent child grandchild; do
 pid=$(cat "$base/$role.pid")
 [ "$(readlink "/proc/$pid/fd/9")" = "$base/target" ]
 grep -qF "$cg" "/proc/$pid/cgroup"
 printf 'BEFORE role=%s pid=%s fd9=regular-file cgroup=verified\n' "$role" "$pid"
done
runuser -u customer -- "$client" inhibit "$gen"
for role in parent child grandchild; do
 pid=$(cat "$base/$role.pid")
 # Linux may briefly retain a zombie, but no live process or FD can remain.
 if [ -e "/proc/$pid/stat" ]; then
  [ "$(awk '{print $3}' "/proc/$pid/stat")" = Z ]
 fi
 [ ! -e "/proc/$pid/fd/9" ]
 printf 'AFTER role=%s live=0 fd9=absent\n' "$role"
done
if [ -e "/sys/fs/cgroup$cg/cgroup.events" ]; then
 grep -q '^populated 0$' "/sys/fs/cgroup$cg/cgroup.events"
else
 echo INERT_CGROUP_REMOVED
fi
[ "$(cat /run/southbag-input-broker/state)" = inhibited ]
echo BROKER_INERT_DESCENDANT_FD_PASS
