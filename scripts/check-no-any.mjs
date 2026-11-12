#!/usr/bin/env node
// Fails the build if the forbidden `any` TYPE appears anywhere under src/.
// tsc strict mode cannot ban *explicit* any on its own, so this guard enforces it.
// Comments and string/template literals are stripped with a small state-machine
// lexer first, so prose such as "for any runtime override" is not a violation;
// only actual code tokens are inspected.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = join(process.cwd(), 'src');
const ANY_PATTERN = /\bany\b/;

/** Remove comments and string/template contents, preserving line structure. */
function stripNonCode(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let state = 'code'; // code | line | block | single | double | template
  while (i < n) {
    const c = source[i];
    const next = source[i + 1] ?? '';
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 2;
      } else if (c === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 2;
      } else if (c === "'") {
        state = 'single';
        out += c;
        i += 1;
      } else if (c === '"') {
        state = 'double';
        out += c;
        i += 1;
      } else if (c === '`') {
        state = 'template';
        out += c;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      } else {
        out += ' ';
      }
      i += 1;
    } else if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 2;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    } else if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (c === '\\') {
        out += '  ';
        i += 2;
      } else if (c === quote) {
        state = 'code';
        out += c;
        i += 1;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    } else {
      // template literal: keep ${ } expressions inspectable, blank the rest
      if (c === '\\') {
        out += '  ';
        i += 2;
      } else if (c === '`') {
        state = 'code';
        out += c;
        i += 1;
      } else if (c === '$' && next === '{') {
        out += '${';
        i += 2;
      } else if (c === '\n') {
        out += '\n';
        i += 1;
      } else {
        out += ' ';
        i += 1;
      }
    }
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let violations = 0;
for (const file of walk(ROOT)) {
  const codeOnly = stripNonCode(readFileSync(file, 'utf8'));
  const lines = codeOnly.split('\n');
  lines.forEach((line, idx) => {
    if (ANY_PATTERN.test(line)) {
      violations += 1;
      console.error(`${relative(process.cwd(), file)}:${idx + 1}: forbidden \`any\` type token: ${line.trim()}`);
    }
  });
}

if (violations > 0) {
  console.error(`\ncheck:no-any failed with ${violations} violation(s). Use \`unknown\` plus narrowing instead.`);
  process.exit(1);
}
console.log('check:no-any passed — no explicit any type under src/.');
