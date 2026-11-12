import { GLContext } from '../gl/context';
import { GLBuffer } from '../gl/buffer';
import { VertexArray } from '../gl/vao';
import { ShaderProgram } from '../gl/program';
import { getTier, DEFAULT_TIER, type QualityTier } from '../config/quality';
import { FULLSCREEN_VERT_SRC, GRADIENT_FRAG_SRC } from './shaders';

/**
 * Foundation renderer. Owns all GPU resources and rebuilds them through the
 * exact same factory after a context restore. The fragment shader is a
 * gradient placeholder — raymarching will replace GRADIENT_FRAG_SRC while the
 * resource/frame scaffolding stays unchanged.
 */
export class CloudRenderer {
  private readonly context: GLContext;
  private program: ShaderProgram | null = null;
  private vbo: GLBuffer | null = null;
  private vao: VertexArray | null = null;
  private tier: QualityTier = getTier(DEFAULT_TIER);

  constructor(context: GLContext) {
    this.context = context;
    this.buildResources();
    // Same factory path as first startup: the registry has already dropped
    // the stale handles, and these new objects register against the new GL.
    this.context.onRestore(() => {
      this.buildResources();
    });
  }

  get currentTier(): QualityTier {
    return this.tier;
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
  }

  private buildResources(): void {
    const { gl, registry } = this.context;

    // Oversized triangle covering the viewport without an index buffer.
    const positions = new Float32Array([-1, -1, 3, -1, -1, 3]);
    this.vbo = new GLBuffer(gl, registry, gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW, 'fullscreen-vbo');
    this.vao = new VertexArray(gl, registry, {
      vbo: this.vbo,
      attributes: [
        {
          location: 0,
          size: 2,
          type: gl.FLOAT,
          stride: 2 * Float32Array.BYTES_PER_ELEMENT,
          offset: 0,
        },
      ],
      label: 'fullscreen-vao',
    });
    this.program = new ShaderProgram(
      gl,
      registry,
      FULLSCREEN_VERT_SRC,
      GRADIENT_FRAG_SRC,
      'foundation-gradient',
    );
  }

  /** Draw one frame. Safe to call while lost — it simply no-ops. */
  render(timeSeconds: number): void {
    if (this.context.isLost || this.program === null || this.vao === null) {
      return;
    }
    const { gl, canvas } = this.context;

    // Always derive the viewport from the live backing-buffer dimensions,
    // so a resize can never leave the drawing stretched or clipped.
    gl.viewport(0, 0, canvas.width, canvas.height);

    this.program.use();
    this.program.setFloat('u_time', timeSeconds);
    this.program.setFloat('u_resolutionScale', this.tier.resolutionScale);
    this.program.setInt('u_raymarchSteps', this.tier.raymarchSteps);

    this.vao.bind();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    VertexArray.unbind(gl);
  }

  dispose(): void {
    this.program?.dispose();
    this.vao?.dispose();
    this.vbo?.dispose();
    this.program = null;
    this.vao = null;
    this.vbo = null;
  }
}
