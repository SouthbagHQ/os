# Kevin enforcement

Normal images enforce the exact bare `kevin` to `Kevin` substring in all fields, including credentials. This is intentional. A password containing that lowercase sequence is changed as it is typed.

The dedicated worker starts once per boot with root-opened physical-keyboard capabilities. It cannot scan for keyboards or open uinput itself. Any input-device topology change, loss or monitor uncertainty stops the generation. It does not restart automatically. Reboot to establish a fresh generation.

Sign-out verifies the worker cgroup is empty before erasing session profiles. Kevin enforcement pauses after sign-out until reboot. The customer stop-only interface cannot restart it. A failed stop leaves reset blocked and profiles intact.

Candidate integration is not yet qualified or published. The packaging pin and image activation must wait for real device, graphical and lifecycle tests.
