/**
 * WebGL-dependent self-tests. They need a real GL context so they run in the
 * browser smoke test (scripts/browser-smoke.mjs), not under plain Node.
 *
 * Covers:
 *  - ShaderCompileError carries the driver info log, stage and annotated
 *    source with the reported line number;
 *  - ProgramLinkError carries getProgramInfoLog output;
 *  - resource registration / dispose unregistration / idempotent dispose;
 *  - a constructor that throws never leaves a half-built registry entry.
 */
import { GLBuffer } from './buffer';
import { ProgramLinkError, ShaderCompileError } from './errors';
import { GLContext } from './context';
import { ResourceRegistry } from './registry';
import { ShaderProgram } from './program';
import { Texture2D } from './texture';
import { VertexArray } from './vao';

export interface GlCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const GOOD_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const GOOD_FRAG = `#version 300 es
precision highp float;
out vec4 out_color;
void main() { out_color = vec4(1.0); }
`;

// Deliberate GLSL error on line 3: undeclared identifier.
const BAD_FRAG = `#version 300 es
precision highp float;
out vec4 out_color;
void main() { out_color = vec4(undeclaredSymbol, 0.0, 0.0, 1.0); }
`;

// Each stage compiles on its own; the link must fail because the same varying
// is declared vec3 in the vertex shader and vec4 in the fragment shader — a
// genuine link-stage error that drivers cannot reject during compilation.
const LINK_FAIL_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec3 v_color;
void main() {
  v_color = vec3(1.0);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const LINK_FAIL_FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 out_color;
void main() { out_color = v_color; }
`;

export function runGlChecks(context: GLContext): GlCheckResult[] {
  const gl = context.gl;
  const results: GlCheckResult[] = [];
  const record = (name: string, passed: boolean, detail: string): void => {
    results.push({ name, passed, detail });
  };

  // 1. Compile error content.
  try {
    new ShaderProgram(gl, new ResourceRegistry(), GOOD_VERT, BAD_FRAG, 'expect-compile-fail');
    record('编译失败抛出 ShaderCompileError', false, 'no error was thrown');
  } catch (error) {
    if (error instanceof ShaderCompileError) {
      const hasLog = error.infoLog.length > 0;
      const isFragment = error.shaderType === 'fragment';
      const mentionsLine = error.message.includes('4') || error.locations.some((l) => l.line === 4);
      const hasAnnotatedSource = error.message.includes('undeclaredSymbol') && error.message.includes('<-- HERE');
      record(
        '编译失败携带 infoLog/类型/源码行号',
        hasLog && isFragment && mentionsLine && hasAnnotatedSource,
        `stage=${error.shaderType}, locations=${JSON.stringify(error.locations)}, hasLog=${hasLog}`,
      );
    } else {
      record('编译失败抛出 ShaderCompileError', false, `wrong type: ${error instanceof Error ? error.name : typeof error}`);
    }
  }

  // 2. Link error content (both shaders compile, link must fail).
  try {
    new ShaderProgram(gl, new ResourceRegistry(), LINK_FAIL_VERT, LINK_FAIL_FRAG, 'expect-link-fail');
    record('链接失败抛出 ProgramLinkError', false, 'no error was thrown');
  } catch (error) {
    if (error instanceof ProgramLinkError) {
      record(
        '链接失败携带 getProgramInfoLog 原文',
        error.infoLog.length > 0 && error.message.includes('getProgramInfoLog'),
        `infoLog="${error.infoLog.trim().slice(0, 140)}"`,
      );
    } else {
      record('链接失败抛出 ProgramLinkError', false, `wrong type: ${error instanceof Error ? error.name : typeof error}`);
    }
  }

  // 3. Registry + idempotent dispose across all wrapper types.
  const registry = new ResourceRegistry();
  const vbo = new GLBuffer(gl, registry, gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 1]), gl.STATIC_DRAW, 'test-vbo');
  const vao = new VertexArray(gl, registry, {
    vbo,
    attributes: [{ location: 0, size: 2, type: gl.FLOAT, stride: 8, offset: 0 }],
    label: 'test-vao',
  });
  const texture = new Texture2D(gl, registry, 2, 2, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]), {
    label: 'test-texture',
  });
  const program = new ShaderProgram(gl, registry, GOOD_VERT, GOOD_FRAG, 'test-program');
  record('四个资源创建后全部登记', registry.count === 4, `count=${registry.count}`);

  // Capture raw handles now so post-dispose GL liveness can be asserted.
  const rawVao = vao.handle;
  const rawTexture = texture.handle;
  const rawProgram = program.handle;
  record(
    '创建后底层 GL 句柄均有效',
    gl.isVertexArray(rawVao) && gl.isTexture(rawTexture) && gl.isProgram(rawProgram),
    `vao=${gl.isVertexArray(rawVao)}, texture=${gl.isTexture(rawTexture)}, program=${gl.isProgram(rawProgram)}`,
  );

  vbo.dispose();
  record('dispose 后注销登记', registry.count === 3, `count=${registry.count}`);
  let secondDisposeThrew = false;
  try {
    vbo.dispose();
  } catch {
    secondDisposeThrew = true;
  }
  record('重复 dispose 不报错且不改变计数', !secondDisposeThrew && registry.count === 3, `count=${registry.count}`);

  // 4. Failed construction leaves no registry residue.
  const before = registry.count;
  let failedCleanly = false;
  let residueDetail = '';
  try {
    new ShaderProgram(gl, registry, GOOD_VERT, BAD_FRAG, 'half-built');
  } catch {
    failedCleanly = registry.count === before;
    residueDetail = `before=${before}, after=${registry.count}`;
  }
  record('构造抛错不残留登记项', failedCleanly, residueDetail);

  registry.disposeAll();
  record('disposeAll 清空注册表（含 vao/texture/program）', registry.count === 0, `count=${registry.count}`);
  record(
    'disposeAll 后底层 GL 句柄全部失效（无泄漏）',
    !gl.isVertexArray(rawVao) && !gl.isTexture(rawTexture) && !gl.isProgram(rawProgram),
    `vao=${gl.isVertexArray(rawVao)}, texture=${gl.isTexture(rawTexture)}, program=${gl.isProgram(rawProgram)}`,
  );
  let disposeAllAgainThrew = false;
  try {
    registry.disposeAll();
  } catch {
    disposeAllAgainThrew = true;
  }
  record('对已释放集合再次 disposeAll 不报错', !disposeAllAgainThrew, `threw=${disposeAllAgainThrew}`);

  // 5. Handles are actually gone after dispose (no leak of live GL objects).
  const leakProbe = new ResourceRegistry();
  const probeBuffer = new GLBuffer(gl, leakProbe, gl.ARRAY_BUFFER, new Float32Array(4), gl.STATIC_DRAW, 'leak-probe');
  const rawHandle = probeBuffer.handle;
  probeBuffer.dispose();
  record('dispose 后底层 GL buffer 已删除', gl.isBuffer(rawHandle) === false, `isBuffer=${gl.isBuffer(rawHandle)}`);

  return results;
}
