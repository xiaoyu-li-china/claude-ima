import { TrackedResource, ResourceRegistry } from './registry';
import { GLBuffer } from './buffer';

export interface VertexAttribute {
  /** attribute location, matching layout(location = N) in GLSL. */
  location: number;
  /** components per element: 1..4. */
  size: number;
  /** e.g. gl.FLOAT. */
  type: number;
  /** bytes between the start of consecutive elements. */
  stride: number;
  /** byte offset of the first element inside the buffer. */
  offset: number;
  normalized?: boolean;
}

/**
 * VAO wrapper: records vertex attribute state against one interleaved (or
 * per-attribute) VBO and, optionally, an index buffer. The bound GLBuffer
 * objects keep independent lifecycle ownership; the VAO only references them.
 */
export class VertexArray extends TrackedResource {
  readonly resourceLabel: string;
  private vao: WebGLVertexArrayObject | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    registry: ResourceRegistry,
    config: {
      vbo: GLBuffer;
      attributes: readonly VertexAttribute[];
      indexBuffer?: GLBuffer;
      label?: string;
    },
  ) {
    super(gl, registry);
    this.resourceLabel = config.label ?? 'VertexArray';
    const handle = gl.createVertexArray();
    if (handle === null) {
      this.abortConstruction();
      throw new Error(`createVertexArray returned null for "${this.resourceLabel}"`);
    }
    try {
      gl.bindVertexArray(handle);
      config.vbo.bind(gl.ARRAY_BUFFER);
      for (const attr of config.attributes) {
        gl.enableVertexAttribArray(attr.location);
        gl.vertexAttribPointer(
          attr.location,
          attr.size,
          attr.type,
          attr.normalized ?? false,
          attr.stride,
          attr.offset,
        );
      }
      if (config.indexBuffer !== undefined) {
        config.indexBuffer.bind(gl.ELEMENT_ARRAY_BUFFER);
      }
      gl.bindVertexArray(null);
    } catch (error) {
      gl.deleteVertexArray(handle);
      this.abortConstruction();
      throw error;
    }
    this.vao = handle;
  }

  get handle(): WebGLVertexArrayObject {
    if (this.vao === null) {
      throw new Error(`VAO "${this.resourceLabel}" has no GL handle (disposed or context lost)`);
    }
    return this.vao;
  }

  bind(): void {
    this.gl.bindVertexArray(this.handle);
  }

  static unbind(gl: WebGL2RenderingContext): void {
    gl.bindVertexArray(null);
  }

  protected releaseHandle(gl: WebGL2RenderingContext): void {
    if (this.vao !== null) gl.deleteVertexArray(this.vao);
  }

  protected resetHandle(): void {
    this.vao = null;
  }
}
