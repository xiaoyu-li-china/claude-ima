import { ProgramLinkError, ShaderCompileError, type ShaderStage } from './errors';
import { ResourceRegistry, TrackedResource } from './registry';

function compileShader(gl: WebGL2RenderingContext, stage: ShaderStage, source: string): WebGLShader {
  const type = stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error(`WebGL2 createShader returned null for ${stage} shader (out of GPU memory?)`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const infoLog = gl.getShaderInfoLog(shader) ?? '(driver returned an empty info log)';
    gl.deleteShader(shader);
    throw new ShaderCompileError(stage, infoLog, source);
  }
  return shader;
}

/** Linked GL program wrapper with cached uniform/attribute locations. */
export class ShaderProgram extends TrackedResource {
  readonly resourceLabel: string;
  private program: WebGLProgram | null = null;
  private readonly uniformLocations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    gl: WebGL2RenderingContext,
    registry: ResourceRegistry,
    vertexSource: string,
    fragmentSource: string,
    label = 'ShaderProgram',
  ) {
    super(gl, registry);
    this.resourceLabel = label;
    try {
      this.program = this.link(vertexSource, fragmentSource);
    } catch (error) {
      this.abortConstruction();
      throw error;
    }
  }

  private link(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = compileShader(gl, 'vertex', vertexSource);
    const fs = compileShader(gl, 'fragment', fragmentSource);
    const program = gl.createProgram();
    if (program === null) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('WebGL2 createProgram returned null (out of GPU memory?)');
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Shaders can be deleted once linked; the program keeps its own copy.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const infoLog = gl.getProgramInfoLog(program) ?? '(driver returned an empty info log)';
      gl.deleteProgram(program);
      throw new ProgramLinkError(infoLog, vertexSource, fragmentSource);
    }
    return program;
  }

  get handle(): WebGLProgram {
    if (this.program === null) {
      throw new Error(`Program "${this.resourceLabel}" has no GL handle (disposed or context lost)`);
    }
    return this.program;
  }

  use(): void {
    this.gl.useProgram(this.handle);
  }

  private location(name: string): WebGLUniformLocation | null {
    const cached = this.uniformLocations.get(name);
    if (cached !== undefined) return cached;
    const loc = this.gl.getUniformLocation(this.handle, name);
    this.uniformLocations.set(name, loc);
    if (loc === null) {
      // Common cause: a uniform optimized out by the compiler. Visible rather
      // than silently dropped, but not fatal — every setter null-checks.
      console.warn(`Uniform "${name}" not found in program "${this.resourceLabel}" (optimized out?)`);
    }
    return loc;
  }

  setFloat(name: string, value: number): void {
    const loc = this.location(name);
    if (loc !== null) this.gl.uniform1f(loc, value);
  }

  setInt(name: string, value: number): void {
    const loc = this.location(name);
    if (loc !== null) this.gl.uniform1i(loc, value);
  }

  setVec2(name: string, x: number, y: number): void {
    const loc = this.location(name);
    if (loc !== null) this.gl.uniform2f(loc, x, y);
  }

  setVec3(name: string, x: number, y: number, z: number): void {
    const loc = this.location(name);
    if (loc !== null) this.gl.uniform3f(loc, x, y, z);
  }

  setMat4(name: string, matrix: Float32Array): void {
    const loc = this.location(name);
    if (loc !== null) this.gl.uniformMatrix4fv(loc, false, matrix);
  }

  protected releaseHandle(gl: WebGL2RenderingContext): void {
    if (this.program !== null) gl.deleteProgram(this.program);
  }

  protected resetHandle(): void {
    this.program = null;
    this.uniformLocations.clear();
  }
}
