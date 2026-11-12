import { TrackedResource, ResourceRegistry } from './registry';

export type BufferTarget =
  | WebGL2RenderingContext['ARRAY_BUFFER']
  | WebGL2RenderingContext['ELEMENT_ARRAY_BUFFER']
  | WebGL2RenderingContext['UNIFORM_BUFFER']
  | WebGL2RenderingContext['COPY_READ_BUFFER']
  | WebGL2RenderingContext['COPY_WRITE_BUFFER'];

/** Typed view accepted when uploading buffer data. */
export type BufferDataSource = BufferSource | ArrayBufferView;

/**
 * WebGL buffer wrapper. Data is uploaded at construction; a future renderer
 * can add bufferSubData updates, the lifecycle/dispose path stays identical.
 */
export class GLBuffer extends TrackedResource {
  readonly resourceLabel: string;
  private buffer: WebGLBuffer | null = null;
  private readonly target: BufferTarget;
  readonly length: number;

  constructor(
    gl: WebGL2RenderingContext,
    registry: ResourceRegistry,
    target: BufferTarget,
    data: BufferDataSource,
    usage: number = gl.STATIC_DRAW,
    label = 'GLBuffer',
  ) {
    super(gl, registry);
    this.resourceLabel = label;
    this.target = target;
    const handle = gl.createBuffer();
    if (handle === null) {
      this.abortConstruction();
      throw new Error(`createBuffer returned null for "${label}"`);
    }
    try {
      gl.bindBuffer(target, handle);
      gl.bufferData(target, data as BufferSource, usage);
    } catch (error) {
      gl.deleteBuffer(handle);
      this.abortConstruction();
      throw error;
    }
    this.buffer = handle;
    this.length = byteLength(data);
  }

  get handle(): WebGLBuffer {
    if (this.buffer === null) {
      throw new Error(`Buffer "${this.resourceLabel}" has no GL handle (disposed or context lost)`);
    }
    return this.buffer;
  }

  bind(target: BufferTarget = this.target): void {
    this.gl.bindBuffer(target, this.handle);
  }

  protected releaseHandle(gl: WebGL2RenderingContext): void {
    if (this.buffer !== null) gl.deleteBuffer(this.buffer);
  }

  protected resetHandle(): void {
    this.buffer = null;
  }
}

function byteLength(data: BufferDataSource): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  // TypedArray / DataView
  return data.byteLength;
}
