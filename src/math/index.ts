export * from './vec3';
export {
  identity,
  multiply,
  perspective,
  lookAt,
  invert,
  transformPoint,
  fromTranslation,
  clone as cloneMat4,
} from './mat4';
export type { Mat4 } from './mat4';
export { runSelfTests } from './selftest';
export type { TestCaseResult } from './selftest';
