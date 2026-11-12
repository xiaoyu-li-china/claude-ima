/**
 * Registry of every live GPU resource. All GL object wrappers register on
 * creation and unregister on dispose, which gives us:
 *  - a single dispose path and a live count for the HUD;
 *  - idempotent disposal (dispose() twice is a no-op);
 *  - context-loss teardown that drops every stale GL handle in one pass.
 */
export interface GpuResource {
  readonly resourceLabel: string;
  /** Release the underlying GL handle. Must be safe to call repeatedly. */
  dispose(): void;
  /**
   * Called on webglcontextlost: the old handles are already invalid, so
   * implementations only clear their references — no GL calls allowed.
   */
  invalidateAfterContextLoss(): void;
}

export class ResourceRegistry {
  private readonly resources = new Set<GpuResource>();

  register(resource: GpuResource): GpuResource {
    this.resources.add(resource);
    return resource;
  }

  unregister(resource: GpuResource): void {
    this.resources.delete(resource);
  }

  get count(): number {
    return this.resources.size;
  }

  /** Snapshot so disposal mutating the set during iteration is safe. */
  list(): readonly GpuResource[] {
    return [...this.resources];
  }

  /**
   * Context loss path: drivers destroy the objects themselves, so call
   * invalidateAfterContextLoss (no GL calls) on each resource and clear the
   * set. The renderer rebuilds resources from its factory callbacks after
   * webglcontextrestored.
   */
  invalidateAll(): void {
    for (const resource of this.list()) {
      resource.invalidateAfterContextLoss();
    }
    this.resources.clear();
  }

  /** Normal shutdown path: real delete* calls on every resource. */
  disposeAll(): void {
    for (const resource of this.list()) {
      resource.dispose();
    }
    this.resources.clear();
  }
}

/**
 * Shared idempotent-dispose bookkeeping. Subclasses implement releaseHandle()
 * (a GL delete call; skipped while the context is lost) and resetHandle().
 */
export abstract class TrackedResource implements GpuResource {
  abstract readonly resourceLabel: string;
  private disposed = false;

  protected abstract releaseHandle(gl: WebGL2RenderingContext): void;
  protected abstract resetHandle(): void;

  constructor(
    protected readonly gl: WebGL2RenderingContext,
    private readonly registry: ResourceRegistry,
  ) {
    this.registry.register(this);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Subclass constructors call this when GL creation fails after super() has
   * already registered the half-built object, so a failed construction never
   * leaves a dead entry in the registry.
   */
  protected abortConstruction(): void {
    this.disposed = true;
    this.registry.unregister(this);
  }

  dispose(): void {
    if (this.disposed) return; // repeated dispose must not throw
    this.disposed = true;
    if (!this.gl.isContextLost()) {
      this.releaseHandle(this.gl);
    }
    this.resetHandle();
    this.registry.unregister(this);
  }

  invalidateAfterContextLoss(): void {
    if (this.disposed) return;
    // The handle is gone with the old context; just forget it, no GL calls.
    this.resetHandle();
    this.disposed = true;
    this.registry.unregister(this);
  }
}
