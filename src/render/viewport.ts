/**
 * Canvas sizing: keeps the GL backing buffer exactly in sync with the CSS
 * element size times devicePixelRatio times the active resolution scale.
 *
 * Invariants after every resize:
 *   canvas.width  === round(cssWidth  * dpr * resolutionScale)
 *   canvas.height === round(cssHeight * dpr * resolutionScale)
 * so the buffer is never stretched by CSS and never mismatched.
 *
 * Inputs handled:
 *  - ResizeObserver fires continuously while the window is dragged; callbacks
 *    are coalesced in one rAF, and canvas.width is only rewritten when the
 *    computed pixel size actually changes (no feedback loop, no needless
 *    framebuffer reallocation).
 *  - devicePixelRatio changes (moving the window between monitors, browser
 *    zoom, headless emulation). Media-query change events are NOT reliably
 *    delivered for emulated/override DPR, so a per-animation-frame watcher
 *    compares the live value and re-applies whenever it moves. The check is
 *    one number comparison per frame; all actual work stays change-gated.
 */
export interface ViewportSnapshot {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  resolutionScale: number;
  bufferWidth: number;
  bufferHeight: number;
}

export type ViewportResizeListener = (snapshot: ViewportSnapshot) => void;

export class CanvasViewport {
  private readonly canvas: HTMLCanvasElement;
  private readonly getResolutionScale: () => number;
  private readonly listener: ViewportResizeListener;
  private readonly resizeObserver: ResizeObserver;
  private frameQueued = false;
  private watcherRafId = 0;
  private watching = true;
  private observedDpr: number;
  private lastSnapshot: ViewportSnapshot | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    getResolutionScale: () => number,
    listener: ViewportResizeListener,
  ) {
    this.canvas = canvas;
    this.getResolutionScale = getResolutionScale;
    this.listener = listener;
    this.observedDpr = window.devicePixelRatio || 1;

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFrame();
    });
    this.resizeObserver.observe(canvas);

    // Initial sizing must not wait for the first observer callback.
    this.scheduleFrame();
    this.watchDpr();
  }

  /** Force a recompute (used when the quality tier changes resolutionScale). */
  refresh(): void {
    this.scheduleFrame();
  }

  get snapshot(): ViewportSnapshot | null {
    return this.lastSnapshot;
  }

  private readonly watchDpr = (): void => {
    if (!this.watching) return;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.observedDpr) {
      this.observedDpr = dpr;
      this.scheduleFrame();
    }
    this.watcherRafId = requestAnimationFrame(this.watchDpr);
  };

  private scheduleFrame(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.apply();
    });
  }

  private apply(): void {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    // A hidden/minimized canvas reports zero; skip rather than allocating a
    // zero-size buffer. The next ResizeObserver tick re-applies.
    if (cssWidth === 0 || cssHeight === 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.observedDpr = dpr;
    const scale = this.getResolutionScale();
    const bufferWidth = Math.max(1, Math.round(cssWidth * dpr * scale));
    const bufferHeight = Math.max(1, Math.round(cssHeight * dpr * scale));

    if (
      this.canvas.width === bufferWidth &&
      this.canvas.height === bufferHeight &&
      this.lastSnapshot !== null &&
      this.lastSnapshot.dpr === dpr &&
      this.lastSnapshot.resolutionScale === scale
    ) {
      return; // identical backing size: nothing to reallocate
    }

    this.canvas.width = bufferWidth;
    this.canvas.height = bufferHeight;

    this.lastSnapshot = {
      cssWidth,
      cssHeight,
      dpr,
      resolutionScale: scale,
      bufferWidth,
      bufferHeight,
    };
    this.listener(this.lastSnapshot);
  }

  dispose(): void {
    this.watching = false;
    cancelAnimationFrame(this.watcherRafId);
    this.resizeObserver.disconnect();
  }
}
