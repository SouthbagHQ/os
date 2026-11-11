# Kevin enforcement

Normal images enforce the exact bare `kevin` to `Kevin` substring in all fields, including credentials. This is intentional. A password containing that lowercase sequence is changed as it is typed.

The dedicated worker starts once per boot with root-opened physical-keyboard capabilities. It cannot scan for keyboards or open uinput itself. Any input-device topology change, loss or monitor uncertainty stops the generation. It does not restart automatically. Reboot to establish a fresh generation.

Sign-out verifies the worker cgroup is empty before erasing session profiles. Kevin enforcement pauses after sign-out until reboot. The customer stop-only interface cannot restart it. A failed stop leaves reset blocked and profiles intact.

Candidate integration is not yet qualified or published. The packaging pin and image activation must wait for real device, graphical and lifecycle tests.

## Durable inputs

The exact qualified worker, corresponding source, package and hashes are preserved at https://github.com/SouthbagHQ/os/releases/tag/worker-input-kevin-ci1. This internal-input prerelease is not an OS release. Normal ISO builds download these immutable versioned assets and verify all three exact hashes; they do not depend on expiring CI artifacts. A changed payload requires a new version and qualification.

## Diagnosing a correction report

The launcher now logs every terminal generation and reason to the service journal,
including normal topology loss, before writing the persistent barrier. A quiet
startup journal alone does not establish that enforcement is still running.
Collect these without entering or sharing any password or typed-text logs:

```sh
sudo systemctl status southbag-espanso.service --no-pager
sudo journalctl -b -u southbag-espanso.service --no-pager
sudo cat /run/southbag-kevin/generation-barrier
```

The v0.1.2 released worker was rechecked with the i8042 AT Translated Set 2
keyboard, QMP `send-key` (30 ms hold), and a USB tablet present. Plain text at
90 ms key spacing and a password fixture at 250 ms spacing both corrected
`kevin` to `Kevin` under TCG. That is not a KVM reproduction of issue #23.
KVM remains unverified; a failing report should include the journal and barrier
above. The fixed all-fields policy and terminal-until-reboot behavior are unchanged.
