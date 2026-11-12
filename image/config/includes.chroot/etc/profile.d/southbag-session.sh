# Starts the Southbag session from the login shell on tty1.
#
# Lives in profile.d rather than ~/.profile: the customer's home is a
# tmpfs mounted empty at every boot (see
# hooks/normal/0015-immutable.hook.chroot), so nothing under it can carry
# the session entry point. The ~/.profile written by 0010-customer stays
# as the fallback for a boot where the RAM home is not mounted. exec, not
# source: sourcing would leak the session script's shell options into the
# login shell, and its early exit would log the customer out.
if [ "$(tty)" = "/dev/tty1" ]; then
  exec /usr/local/bin/southbag-session
fi
