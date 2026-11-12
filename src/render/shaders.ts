/**
 * GLSL ES 3.00 sources for the foundation validation pass.
 * This is deliberately NOT cloud rendering: an oversized fullscreen triangle
 * plus a time-varying gradient proves the whole pipeline (compile/link, VAO,
 * uniforms, resize, context restore) end to end. Raymarching, noise and
 * shadows will replace only the fragment stage later.
 */

export const FULLSCREEN_VERT_SRC = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const GRADIENT_FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform float u_time;
uniform int u_raymarchSteps;
uniform float u_resolutionScale;
out vec4 out_color;

void main() {
  vec3 lowColor = vec3(0.04, 0.06, 0.10);
  vec3 highColor = vec3(0.18, 0.32, 0.55);
  vec3 color = mix(lowColor, highColor, v_uv.y);

  // Quality parameters are genuinely consumed so a bad/unset uniform cannot
  // be silently optimized away; the moving band proves the frame is alive.
  float stepsFactor = 0.5 + float(u_raymarchSteps) / 192.0;
  float band = sin(v_uv.x * 6.2831853 * stepsFactor + u_time) * 0.5 + 0.5;
  color += band * 0.05 * u_resolutionScale;

  out_color = vec4(color, 1.0);
}
`;
