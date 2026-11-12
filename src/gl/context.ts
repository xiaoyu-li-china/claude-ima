import { ResourceRegistry } from './registry';

export type ContextState = 'active' | 'lost';

export type ContextStateListener = (state: ContextState) => void;
export type RestoreCallback = () => void;

export interface GLContextOptions {
  /** Required for the "simulate context loss" debug button. */
  requireLoseExtension?: boolean;
}

/**
 * Owns the WebGL2 context, its ResourceRegistry and the
 * webglcontextlost / webglcontextrestored lifecycle.
 *
 * Loss flow:
 *   event(preventDefault) -> state='lost' -> registry.invalidateAll()
 *   (every wrapper drops its stale handle, no GL calls) -> listeners notified,
 *   render loop pauses.
 * Restore flow:
 *   webglcontextrestored -> state='active' -> registered rebuild callbacks
 *   recreate every resource through the same factory code -> render resumes.
 */
export class GLContext {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly registry: ResourceRegistry;
  private state: ContextState = 'active';
  private readonly listeners = new Set<ContextStateListener>();
  private readonly restoreCallbacks: RestoreCallback[] = [];
  private readonly loseExtension: WEBGL_lose_context | null;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.registry = new ResourceRegistry();
    this.loseExtension = gl.getExtension('WEBGL_lose_context');

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  static create(canvas: HTMLCanvasElement, options: GLContextOptions = {}): GLContext {
    const gl = canvas.getContext('webgl2', {
      antialias: false, // fullscreen-triangle renderer; MSAA comes later if needed
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (gl === null) {
      throw new Error('WebGL2 is not available in this browser or hardware acceleration is disabled');
    }
    const context = new GLContext(canvas, gl);
    if (options.requireLoseExtension && context.loseExtension === null) {
      throw new Error('WEBGL_lose_context extension is unavailable; cannot simulate context loss');
    }
    return context;
  }

  get currentState(): ContextState {
    return this.state;
  }

  get isLost(): boolean {
    return this.state === 'lost' || this.gl.isContextLost();
  }

  get canSimulateLoss(): boolean {
    return this.loseExtension !== null;
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  onStateChange(listener: ContextStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Register resource-rebuild logic invoked after webglcontextrestored.
   * Callbacks run in registration order and may create GL resources freely.
   */
  onRestore(callback: RestoreCallback): () => void {
    this.restoreCallbacks.push(callback);
    return () => {
      const idx = this.restoreCallbacks.indexOf(callback);
      if (idx >= 0) this.restoreCallbacks.splice(idx, 1);
    };
  }

  private readonly handleContextLost = (event: Event): void => {
    // Without preventDefault the context is never restored.
    event.preventDefault();
    if (this.state === 'lost') return;
    this.state = 'lost';
    // Old GL handles are invalid: drop references without issuing GL calls.
    this.registry.invalidateAll();
    console.warn('[GLContext] webglcontextlost — render paused, GPU references released');
    this.listeners.forEach((l) => l(this.state));
  };

  private readonly handleContextRestored = (): void => {
    if (this.state !== 'lost') return;
    this.state = 'active';
    console.info('[GLContext] webglcontextrestored — rebuilding GPU resources');
    // Rebuild through the same factories used at first startup.
    for (const callback of this.restoreCallbacks) {
      callback();
    }
    this.listeners.forEach((l) => l(this.state));
  };

  /** Debug helper driven by the HUD button. */
  simulateLoss(): void {
    if (this.loseExtension === null) {
      throw new Error('WEBGL_lose_context extension is unavailable');
    }
    this.loseExtension.loseContext();
  }

  /** Manual restore; real restores also arrive as webglcontextrestored events. */
  simulateRestore(): void {
    if (this.loseExtension === null) {
      throw new Error('WEBGL_lose_context extension is unavailable');
    }
    this.loseExtension.restoreContext();
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.listeners.clear();
    this.restoreCallbacks.length = 0;
    if (!this.isLost) {
      this.registry.disposeAll();
    }
  }
}
