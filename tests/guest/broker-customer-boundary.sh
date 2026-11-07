#!/bin/sh
# Run as root in a disposable networkless image. No keyboard reader, auth,
# lock UI, signed-in account, service enablement or activation is required.
# This tests an already-started inhibit-only broker against the REAL customer.
set -eu
[ "$(id -u)" = 0 ] || { echo 'root guest required' >&2; exit 2; }
broker=/usr/local/sbin/southbag-input-broker
[ -x "$broker" ] || exit 2
[ "$(stat -c '%U:%G:%a' /run/southbag-input-broker)" = 'root:root:700' ] || exit 2
# Root-owned state must stay private; never repair the test by loosening it.
gen=$("$broker" current | sed -n 's/^generation=\([1-9][0-9]*\) state=inhibited$/\1/p')
[ -n "$gen" ] || { echo 'begun inhibited broker required' >&2; exit 2; }
client=/usr/local/bin/southbag-input-client
runuser -u customer -- "$client" current
runuser -u customer -- "$client" inhibit "$gen"
# Customer cannot establish a generation or activate a worker.
if runuser -u customer -- "$broker" begin-generation; then exit 1; fi
for verb in start restart enable authorize-unlock; do
 if runuser -u customer -- "$broker" "$verb" "$gen"; then exit 1; fi
done
[ "$(stat -c '%U:%G:%a' /run/southbag-input-broker)" = 'root:root:700' ]
[ "$(cat /run/southbag-input-broker/generation)" = "$gen" ]
echo BROKER_CUSTOMER_BOUNDARY_PASS
