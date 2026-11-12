#!/usr/bin/env node
/**
 * Node entry for the math self-tests: `npm test`.
 * The cases themselves live in src/math/selftest.ts and are shared verbatim
 * with the browser HUD, so this run is the same code the page executes.
 */
import { runSelfTests } from '../src/math/selftest.ts';
import { runConfigChecks } from '../src/config/config-selftest.ts';

type NamedResult = { name: string; passed: boolean; detail: string };

const suites: ReadonlyArray<{ title: string; results: readonly NamedResult[] }> = [
  { title: 'math', results: runSelfTests() },
  { title: 'config', results: runConfigChecks() },
];

let failed = 0;
let total = 0;

for (const suite of suites) {
  console.log(`--- ${suite.title} ---`);
  for (const r of suite.results) {
    total += 1;
    const mark = r.passed ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${r.name}`);
    console.log(`      ${r.detail}`);
    if (!r.passed) failed += 1;
  }
  console.log('');
}

if (failed > 0) {
  console.error(`Self-tests failed: ${failed}/${total} case(s).`);
  process.exit(1);
}
console.log(`Self-tests passed: ${total}/${total} case(s).`);
