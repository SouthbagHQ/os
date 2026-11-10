# Script-dialog support for cog (wayland platform)

Problem: cog 0.18.4 (the stock trixie package, and the browser the Southbag
session runs) contains no handler for WebKitWebView::script-dialog. On WPE
WebKit 2.48.3 an unhandled script dialog is silently dropped: window.alert()
returns immediately with nothing rendered. Verified on-device 2026-11-06
(probe page: fetch-mark / alert() / fetch-mark - both marks reached the
server in the same second, no dialog on screen). Southbag Identity's
untrusted-app consent gauntlet is ten sequential native acknowledgements
(alert dialogs) that the user must actually see and dismiss, so the journey
cannot complete on the stock browser. This adds a rendered, actionable
script-dialog implementation to cog's wayland platform.

Design (mirrors the existing option-menu popup, cog-popup-menu-wl.c):

- cog_wl_platform_init_web_view() connects "script-dialog" to
  on_script_dialog() in cog-platform-wl.c.
- on_script_dialog() refs the WebKitScriptDialog, builds a CogScriptDialog
  (new cog-script-dialog-wl.c), and shows it in a centered xdg_popup using
  the same shm-buffer + cairo machinery as the option-menu popup. One
  dialog at a time; further signals queue (the consent gauntlet fires them
  strictly sequentially).
- The dialog renders the message text plus buttons:
    ALERT:                [OK]      -> webkit_script_dialog_close()
    CONFIRM:              [OK][Cancel] -> confirm_set_confirmed(TRUE/FALSE) + close
    BEFORE_UNLOAD_CONFIRM: same as CONFIRM
    PROMPT:               NOT INTERCEPTED - the WebKitScriptDialog API in
                          2.48.3 cannot express a prompt cancel (JS null):
                          webkit_script_dialog_close() always completes a
                          prompt with a string (verified in wpewebkit-2.48.3
                          WebKitScriptDialog.cpp: prompt completion ignores
                          the bool and always completes with
                          String::fromUTF8(text); the WebKitWebView.cpp
                          wrapper ignores the bool too). Rendering our own
                          prompt would CHANGE semantics, so prompts keep
                          stock engine behavior (handler returns FALSE).
- Input: keyboard first-class (the Identity journey is keyboard-driven):
  Return activates the default button, Escape cancels where a cancel
  exists (never on ALERT), Tab/Left/Right moves between buttons. Pointer
  press on a button activates it; v1 has no hover highlight. Presses
  outside the dialog are swallowed - no outside dismissal.
- NOTHING auto-closes or auto-confirms. Every dismissal is a deliberate
  key or click. No xdg_popup grab is taken (alerts fire without an input
  serial, so a grab could be refused); modality is enforced by routing all
  keys and pointer presses to the dialog while it is up.
- Lifetime/anti-staleness (reviewed 2026-11-06): dedicated
  xdg_surface/xdg_popup listeners for dialogs (the shared option-menu
  ones guard on popup_data and would never paint the dialog, and their
  popup_done would tear down the wrong object). A new page load
  (load-changed/WEBKIT_LOAD_STARTED), the view's close signal, or view
  destruction (g_object_weak_ref) retires any pending dialog and drains
  the FIFO WITHOUT answering it. Retire cannot imply acceptance, verified
  at the API level (wpewebkit-2.48.3 WebKitScriptDialogPrivate.h:
  `bool confirmed { false }`; WebKitScriptDialog.cpp close() completes
  confirm/before-unload with dialog->confirmed): an unanswered confirm
  always completes FALSE. Compositor popup_done tears down the same way.
- Text is drawn with cairo's toy font API (fontconfig + DejaVu, already in
  the image for swaylock); shm pool helpers come from os-compatibility.c,
  same as the option menu.

Build integration: image/config/hooks/normal/0022-cog-dialog-build.hook.chroot
builds cog 0.18.4 (upstream tarball, sha256
31d7079db2eeed790899d2f1f824dd6a54bf30d072d196d737be572f105d99b1 pinned,
-Dplatforms=wayland) inside the chroot and applies the patch staged at
image/config/includes.chroot/opt/cog-dialog.patch (following 0016's
includes.chroot staging model). It dpkg-diverts /usr/bin/cog and the
stock cogplatform-wl.so module (both kept as .stock) and installs the
patched ones; cogctl stays stock. southbag-shell execs /usr/bin/cog
verbatim, so the launcher needs no change. Toolchain is purged by exact
dpkg-delta name, same as 0016-lockd-build.

Status: PR-prep DRAFT. The patch was produced as a real diff against the
pristine 0.18.4 tree (tag c462567), verified to apply cleanly with both
patch -p1 --dry-run and git apply --check, and COMPILE+LINK VERIFIED
2026-11-06 (status: compiled candidate - this sysroot build used a
relaxed link flag and is not image-hook validation): full meson/ninja build of the patched tree (meson setup
-Dplatforms=wayland; ninja RC=0, zero warnings on the new/changed files
with -Wall) against a Debian trixie sysroot carrying the image's exact
WPE WebKit version (libwpewebkit-2.0-dev 2.48.3-1, libsoup 3.6.5,
wayland 1.23.1, cairo 1.18.4, xkbcommon 1.7.0, epoxy 1.5.10,
libmanette 0.2). All six webkit_script_dialog_* API calls resolve
against libWPEWebKit-2.0.so 2.48.3. The sandbox link step needed
-Wl,--allow-shlib-undefined only because the sysroot omits WPE's
unrelated transitive runtime libs (gstreamer et al.); the in-chroot
hook builds against the complete installed system and needs no such
flag. NOT yet runtime-verified: the dialog has not been rendered
on-device; that needs an image rebuild with this hook, then the real
ten-acknowledgement journey. Known review points: xdg_popup without a
grab under labwc, buffer-scaled pointer coords (handled by scale
division inside the dialog), PROMPT v1 default-text limitation.

Qualification bar for merging anything: the real ten-acknowledgement
consent journey completes on-device with rendered, actionable dialogs.

---

# Related patch: shutdown-crash teardown ordering (cog-shutdown-ordering.patch)

Problem: every plain termination of the Southbag shell session (SIGTERM,
session stop) crashed cog in ClientBundleEGL::releaseShmBuffer during
platform finalize (symbolized core backtrace captured 2026-11-09). Root
cause, source-verified against cog 0.18.4 (tag c462567) and
wpebackend-fdo 1.16.0: webkit_web_view_backend_new() registers
wpe_view_backend_exportable_fdo_destroy as the destroy notify for
wpe_host_data.exportable, so when the web view is destroyed the
WebKit-side client bundle is deleted, but the wayland platform's global
wpe_host_data.exportable keeps pointing at the freed exportable.
cog_wl_platform_finalize() -> clear_buffers() -> shm_buffer_destroy()
then dispatches release_shm_exported_buffer through the stale pointer
into unmapped heap (fault at clientBundle+0x10 = its viewBackend
member). ViewBackend::~ViewBackend upstream never clears the pointer.

Fix (applied after the dialog patch in the same 0022 hook): a destroy
notify wrapper (on_wk_view_backend_destroyed) clears the platform-global
exportable before calling the real wpe_view_backend_exportable_fdo_destroy,
plus NULL-guards on every exportable dispatch reachable during or after
teardown (frame-complete, shm buffer release, shm_buffer_destroy,
compositor buffer release, finalize image release). Live-backend dispatch
paths are unchanged; teardown now frees buffers without touching the dead
client bundle.

Status: PR-prep DRAFT. Produced as a real diff against the pristine
0.18.4 tree plus the dialog patch (exactly the tree the hook builds);
applies cleanly with both patch -p1 --dry-run and git apply --check, and
the applied result is byte-identical to the tested tree. COMPILE+LINK
VERIFIED 2026-11-10 with the same meson/ninja trixie-sysroot build as
the dialog patch (RC=0, zero warnings on cog-platform-wl.c). Unit-level
fixture verification 2026-11-10: the patched file was compiled with a
stub harness (no Wayland server, no WebKit) driving four cases - (A)
exportable destroyed before clear_buffers: zero dispatches into the dead
bundle, all buffers/pools still freed, buffer list drained; (B) live
exportable: exactly one release dispatch with correct arguments (normal
path preserved); (C) compositor release after teardown: no dispatch,
stale pointer cleared; (D) frame callback after teardown: no dispatch,
dispatched when live. NOT runtime-verified: the crash path has not been
exercised on-device. Proving the TERM no longer SIGSEGVs requires an
image rebuild with this hook and a booted session; that is the
qualification bar for merging and is deliberately out of scope for this
branch.
