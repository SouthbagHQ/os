# Pointer button compatibility

Cog 0.18.4 passed the Linux button code on press and zero on release.
With the current WPE runtime this delivered DOM down/up events but no click.
Keyboard activation still worked.

The image now backports Igalia/cog commit
[f87b71b7467218bacd71b00fcf499ca44b73bc35](https://github.com/Igalia/cog/commit/f87b71b7467218bacd71b00fcf499ca44b73bc35):
normalize Linux button codes and keep the same button identity on release.
The older source also needs an explicit linux/input-event-codes.h include.
The build hook applies this after the dialog and shutdown patches, then
removes the patch and build tools as before.

Private in-image qualification used a local diagnostic page, real native Cog
processes and QEMU absolute tablet events. Before the patch the page received
pointerdown/up and mousedown/up but no click. With the rebuilt module, the same
click emitted a DOM click and activated the button. This is emulator overlay
proof, not a fresh-image or physical hardware claim. Existing dialog and
shutdown behavior still needs qualification on the resulting ISO.

## Surface-entry coordinates

Wayland can send pointer-enter and a button press without an intervening motion.
Update the saved coordinates from pointer-enter so the native dialog hit-test
uses its new surface coordinates, not the previous page coordinates. This also
fixes a direct move-to-dialog-button click that otherwise needed a second move.
The local emulator regression passed this exact move-and-click sequence with
the rebuilt module; a fresh image is required before calling the amendment
image-qualified.
