/**
 * Column-major 4x4 matrices stored as 16-element Float32Array, matching the
 * WebGL uniform layout (gl.uniformMatrix4fv with transpose=false).
 *
 * Element m[col * 4 + row]. A point transform is m * v (column vectors).
 */
import type { Vec3 } from './vec3';
import { cross, normalize, subtract } from './vec3';

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function clone(m: ArrayLike<number>): Mat4 {
  const out = new Float32Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = m[i] ?? 0;
  return out;
}

/** out = a * b (column-vector convention: apply b first, then a). */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * OpenGL-style perspective projection. Produces the standard WebGL clip-space
 * matrix (depth mapped to [-1, 1]); invert() below is its exact inverse.
 */
export function perspective(fovyRadians: number, aspect: number, near: number, far: number): Mat4 {
  if (!(fovyRadians > 0 && fovyRadians < Math.PI)) {
    throw new RangeError(`mat4.perspective: fovy must be in (0, PI), got ${fovyRadians}`);
  }
  if (!(aspect > 0)) {
    throw new RangeError(`mat4.perspective: aspect must be > 0, got ${aspect}`);
  }
  if (!(near > 0) || !(far > near)) {
    throw new RangeError(`mat4.perspective: require 0 < near < far, got near=${near}, far=${far}`);
  }
  const f = 1 / Math.tan(fovyRadians / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/** Right-handed view matrix looking from eye toward center, with up hint. */
export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = normalize(subtract(center, eye)); // forward (camera -Z)
  const s = normalize(cross(f, up)); // right
  const u = cross(s, f); // recomputed up, guaranteed orthogonal
  const m = identity();
  m[0] = s[0];
  m[4] = s[1];
  m[8] = s[2];
  m[1] = u[0];
  m[5] = u[1];
  m[9] = u[2];
  m[2] = -f[0];
  m[6] = -f[1];
  m[10] = -f[2];
  m[12] = -dot3(s, eye);
  m[13] = -dot3(u, eye);
  m[14] = dot3(f, eye);
  return m;
}

function dot3(a: readonly number[], b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * General 4x4 inverse via cofactor expansion. Throws on a singular matrix.
 * For the perspective matrix produced here this is the exact inverse
 * projection, so perspective(p) followed by invert() round-trips NDC points.
 */
export function invert(a: ArrayLike<number>): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(det) || det === 0) {
    throw new RangeError('mat4.invert: matrix is singular, inverse does not exist');
  }
  det = 1 / det;

  const out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 + a12 * b08) * det;
  out[13] = (a00 * b09 - a01 * b07 - a02 * b08) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** Transform a point with implicit w=1, perspective-divided back to xyz. */
export function transformPoint(m: ArrayLike<number>, p: Vec3): Vec3 {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w === 0) {
    throw new RangeError('mat4.transformPoint: homogeneous w is 0');
  }
  return [x / w, y / w, z / w];
}

/** Build a translation matrix (used by tests / future camera work). */
export function fromTranslation(v: Vec3): Mat4 {
  const m = identity();
  m[12] = v[0];
  m[13] = v[1];
  m[14] = v[2];
  return m;
}
