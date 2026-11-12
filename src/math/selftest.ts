/**
 * DOM-free math self-tests. The same suite runs in the browser (HUD panel)
 * and under Node via `npm test` (scripts/run-tests.ts through tsx).
 */
import { identity, invert, lookAt, multiply, perspective, transformPoint } from './mat4';
import { dot, normalize } from './vec3';
import type { Mat4 } from './mat4';
import type { Vec3 } from './vec3';

export interface TestCaseResult {
  name: string;
  passed: boolean;
  detail: string;
}

const F32_TOLERANCE = 1e-5;

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return max;
}

function isNear(a: number, b: number, eps = F32_TOLERANCE): boolean {
  return Math.abs(a - b) <= eps;
}

/** 1. Identity: I*I == I and transforming a point leaves it untouched. */
function testIdentity(): TestCaseResult {
  const i = identity();
  const squared = multiply(i, i);
  const matrixOk = maxAbsDiff(squared, i) === 0;
  const p: Vec3 = [3.5, -7.25, 11.0];
  const back = transformPoint(i, p);
  const pointOk = p.every((v, idx) => v === back[idx]);
  return {
    name: '单位矩阵：I×I = I 且 I·p = p',
    passed: matrixOk && pointOk,
    detail: `matrixDiff=${maxAbsDiff(squared, i).toExponential(1)}, pointDiff=${maxAbsDiff(p, back).toExponential(1)}`,
  };
}

/** 2. Perspective round trip: invert(P) * P == I within f32 tolerance. */
function testPerspectiveRoundTrip(): TestCaseResult {
  const p = perspective(Math.PI / 3, 16 / 9, 0.1, 100);
  const pInv = invert(p);
  const product = multiply(pInv, p);
  const diff = maxAbsDiff(product, identity());
  return {
    name: '透视投影往返：invert(P) × P ≈ I',
    passed: diff <= F32_TOLERANCE,
    detail: `maxElementDiff=${diff.toExponential(2)} (tol ${F32_TOLERANCE})`,
  };
}

/** 3. lookAt orthogonality: rotation axes are unit, pairwise orthogonal. */
function testLookAtOrthogonality(): TestCaseResult {
  const view = lookAt([2, 3, 5], [0, 0.5, 0], [0, 1, 0]);
  const right: Vec3 = [view[0], view[1], view[2]];
  const up: Vec3 = [view[4], view[5], view[6]];
  const backward: Vec3 = [view[8], view[9], view[10]]; // camera +Z = -forward
  const axes: readonly (readonly number[])[] = [right, up, backward];
  const unitErrors = axes.map((a) => Math.abs(1 - Math.hypot(a[0], a[1], a[2])));
  const dots = [
    Math.abs(dot(right, up)),
    Math.abs(dot(right, backward)),
    Math.abs(dot(up, backward)),
  ];
  const worstUnit = Math.max(...unitErrors);
  const worstDot = Math.max(...dots);
  const passed = worstUnit <= F32_TOLERANCE && worstDot <= F32_TOLERANCE;

  // R^T * R must also be identity for a pure rotation.
  const r = new Float32Array(16);
  r.set(view.subarray(0, 3), 0);
  r.set(view.subarray(4, 7), 4);
  r.set(view.subarray(8, 11), 8);
  r[15] = 1;
  const rrT = multiply(r, transpose3(r));
  const orthoDiff = maxAbsDiff(rrT, identity());
  return {
    name: 'lookAt 正交性：三轴单位且两两正交 (R·Rᵀ ≈ I)',
    passed: passed && orthoDiff <= F32_TOLERANCE,
    detail: `maxUnitError=${worstUnit.toExponential(2)}, maxAxisDot=${worstDot.toExponential(2)}, R·Rᵀ diff=${orthoDiff.toExponential(2)}`,
  };
}

function transpose3(m: Mat4): Mat4 {
  const t = identity();
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      t[row * 4 + col] = m[col * 4 + row];
    }
  }
  return t;
}

/**
 * 4. Inverse projection restores NDC: project a view-space point to NDC,
 * unproject with invert(P), then re-project — both the view point and the
 * NDC coordinates must be recovered.
 */
function testUnprojectNdc(): TestCaseResult {
  const p = perspective((60 * Math.PI) / 180, 16 / 9, 0.25, 50);
  const pInv = invert(p);
  const viewPoint: Vec3 = [1.25, -0.75, -8.0]; // view space, camera looks down -Z

  // Forward: view -> clip -> NDC (perspective divide).
  const clip = multiplyMatrixVector(p, [viewPoint[0], viewPoint[1], viewPoint[2], 1]);
  const ndc: Vec3 = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];

  // Inverse: rebuild a clip point from NDC using the known w, apply P^-1.
  const w = clip[3];
  const unprojected = multiplyMatrixVector(pInv, [ndc[0] * w, ndc[1] * w, ndc[2] * w, w]);
  const recoveredView: Vec3 = [
    unprojected[0] / unprojected[3],
    unprojected[1] / unprojected[3],
    unprojected[2] / unprojected[3],
  ];
  const viewDiff = maxAbsDiff(recoveredView, viewPoint);

  // Re-project the recovered point; NDC must match exactly.
  const reClip = multiplyMatrixVector(p, [recoveredView[0], recoveredView[1], recoveredView[2], 1]);
  const reNdc: Vec3 = [reClip[0] / reClip[3], reClip[1] / reClip[3], reClip[2] / reClip[3]];
  const ndcDiff = maxAbsDiff(reNdc, ndc);

  const insideCube = ndc.every((c) => c >= -1 && c <= 1);
  return {
    name: '逆投影还原 NDC：view→NDC→P⁻¹→view 往返一致',
    passed: viewDiff <= F32_TOLERANCE && ndcDiff <= F32_TOLERANCE && insideCube,
    detail: `viewDiff=${viewDiff.toExponential(2)}, ndcDiff=${ndcDiff.toExponential(2)}, ndc=(${ndc.map((n) => n.toFixed(4)).join(', ')})`,
  };
}

function multiplyMatrixVector(m: ArrayLike<number>, v: readonly number[]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    out[row] =
      m[row] * v[0] + m[4 + row] * v[1] + m[8 + row] * v[2] + m[12 + row] * v[3];
  }
  return out;
}

export function runSelfTests(): TestCaseResult[] {
  return [testIdentity(), testPerspectiveRoundTrip(), testLookAtOrthogonality(), testUnprojectNdc()];
}

/** Re-exported so callers can sanity-check tolerances against their f32 path. */
export function normalizedAxisCheck(v: Vec3): number {
  const n = normalize(v);
  return Math.abs(1 - dot(n, n));
}

export function matrixNearIdentity(m: Mat4, eps = F32_TOLERANCE): boolean {
  return isNear(maxAbsDiff(m, identity()), 0, eps);
}
