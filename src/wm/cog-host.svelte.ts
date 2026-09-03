/**
 * Window lifecycle on the device.
 *
 * The other implementation of `WindowHost` draws windows in a page. This one
 * does not draw anything: it asks the session to start the app as its own cog
 * process, and labwc takes it from there. Position, size, stacking, focus and
 * closing all belong to the compositor, which is why almost every method here
 * is empty. That is not a stub — there is genuinely nothing for the shell to
 * do once the process exists.
 *
 * The panel's window list will come from the compositor too, through
 * wlr-foreign-toplevel. Until that exists this host reports no windows, which
 * is honest: it does not know.
 */

import type { Rect, SnapZone } from "./geometry";
import type { ManagedWindow, WindowHost } from "./host.svelte";
import type { Size } from "./geometry";

export class CogWindowHost implements WindowHost {
  windows = $state<ManagedWindow[]>([]);
  area = $state<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  readonly focusedId = null;

  #failed = $state<string | null>(null);

  /** The last launch that did not work, for the shell to show if it wants. */
  get failed() {
    return this.#failed;
  }

  open(appId: string, _spec: { title: string; size: Size; min: Size }): number {
    void _spec;
    fetch(`/cgi-bin/launch?app=${encodeURIComponent(appId)}`)
      .then((response) => {
        this.#failed = response.ok ? null : appId;
      })
      .catch(() => {
        this.#failed = appId;
      });
    return 0;
  }

  // The compositor owns all of this.
  close(_id: number) {}
  focus(_id: number) {}
  toggleMinimise(_id: number) {}
  toggleMaximise(_id: number) {}
  snapTo(_id: number, _zone: SnapZone) {}
  setRect(_id: number, _rect: Rect) {}
  setTitle(_id: number, _title: string) {}
}
