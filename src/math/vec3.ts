/**
 * Minimal column-vector 3D math. Vectors are plain readonly-tuple friendly
 * mutable number triples — no class hierarchy, allocation stays explicit.
 */
export type Vec3 = [number, number, number];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function clone(v: readonly number[]): Vec3 {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
}

export function add(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: readonly number[], s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(v: readonly number[]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: readonly number[]): Vec3 {
  const len = length(v);
  if (len === 0) {
    throw new RangeError('vec3.normalize: cannot normalize a zero-length vector');
  }
  return scale(v, 1 / len);
}
