import { TrackedResource, ResourceRegistry } from './registry';

export interface Texture2DOptions {
  internalFormat?: number; // default gl.RGBA8
  format?: number; // default gl.RGBA
  type?: number; // default gl.UNSIGNED_BYTE
  /** Default: clamp-to-edge + linear, safe for any size including NPOT. */
  wrapS?: number;
  wrapT?: number;
  minFilter?: number;
  magFilter?: number;
  label?: string;
}

/**
 * 2D texture wrapper. The foundation layer only creates solid-color/placeholder
 * textures (no noise textures yet); upload helpers will be added with the
 * raymarching feature without changing this lifecycle.
 */
export class Texture2D extends TrackedResource {
  readonly resourceLabel: string;
  private texture: WebGLTexture | null = null;
  readonly width: number;
  readonly height: number;

  constructor(
    gl: WebGL2RenderingContext,
    registry: ResourceRegistry,
    width: number,
    height: number,
    data: TexImageSource | ArrayBufferView | null,
    options: Texture2DOptions = {},
  ) {
    super(gl, registry);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      this.abortConstruction();
      throw new RangeError(`Texture2D: dimensions must be positive integers, got ${width}x${height}`);
    }
    this.resourceLabel = options.label ?? 'Texture2D';
    this.width = width;
    this.height = height;

    const handle = gl.createTexture();
    if (handle === null) {
      this.abortConstruction();
      throw new Error(`createTexture returned null for "${this.resourceLabel}"`);
    }
    try {
      const internalFormat = options.internalFormat ?? gl.RGBA8;
      const format = options.format ?? gl.RGBA;
      const type = options.type ?? gl.UNSIGNED_BYTE;

      gl.bindTexture(gl.TEXTURE_2D, handle);
      if (data === null || ArrayBuffer.isView(data)) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          internalFormat,
          width,
          height,
          0,
          format,
          type,
          data as ArrayBufferView | null,
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          internalFormat,
          width,
          height,
          0,
          format,
          type,
          data,
        );
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.wrapS ?? gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, options.wrapT ?? gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.minFilter ?? gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.magFilter ?? gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, null);
    } catch (error) {
      gl.deleteTexture(handle);
      this.abortConstruction();
      throw error;
    }
    this.texture = handle;
  }

  get handle(): WebGLTexture {
    if (this.texture === null) {
      throw new Error(`Texture "${this.resourceLabel}" has no GL handle (disposed or context lost)`);
    }
    return this.texture;
  }

  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
  }

  protected releaseHandle(gl: WebGL2RenderingContext): void {
    if (this.texture !== null) gl.deleteTexture(this.texture);
  }

  protected resetHandle(): void {
    this.texture = null;
  }
}
