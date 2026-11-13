/**
 * Stops a Torn tab that keeps navigating by itself.
 * - Fast loop: more than 6 navigations within 2.5 s, whatever started them (always on).
 * - Slow loop: more than 8 navigations within 60 s while nobody clicks, types or taps in the tab
 *   (a page that redirects every few seconds would otherwise run forever and keep loading Torn pages).
 *   It stays stopped until the user touches the page again.
 * Only navigations the page starts are counted (will-navigate); the app's own loadURL/reload calls are not.
 */
const FAST_WINDOW_MS = 2500, FAST_MAX = 6;
const SLOW_WINDOW_MS = 60_000, SLOW_MAX = 8;
const USER_INPUT = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'touchStart', 'gestureTap', 'pointerDown']);

function createNavigationGuard({ now = Date.now, slowGuard = () => true } = {}) {
  const recent = [], unattended = [];
  let reported = false;
  return {
    /** Call for every input event of the tab; a real click, key press or tap resets the slow-loop count. */
    input(type) {
      if (!USER_INPUT.has(type)) return;
      unattended.length = 0;
      reported = false;
    },
    /**
     * Call from will-navigate. Returns null to allow the navigation, otherwise
     * { kind: 'fast' | 'slow', report } where report is true only for the first stop since the last user input.
     */
    navigate() {
      const t = now();
      while (recent.length && t - recent[0] > FAST_WINDOW_MS) recent.shift();
      while (unattended.length && t - unattended[0] > SLOW_WINDOW_MS) unattended.shift();
      recent.push(t);
      unattended.push(t);
      const kind = recent.length > FAST_MAX ? 'fast' : unattended.length > SLOW_MAX && slowGuard() ? 'slow' : null;
      if (!kind) { reported = false; return null; } // the loop ended: a later one gets its own notice
      const report = !reported;
      reported = true;
      return { kind, report };
    },
  };
}

module.exports = { createNavigationGuard, USER_INPUT, FAST_WINDOW_MS, FAST_MAX, SLOW_WINDOW_MS, SLOW_MAX };
