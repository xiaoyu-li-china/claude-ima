import { GLContext } from './gl/context';
import { CloudRenderer } from './render/renderer';
import { CanvasViewport } from './render/viewport';
import { Hud } from './ui/hud';
import { runSelfTests } from './math';
import { runConfigChecks } from './config/config-selftest';
import { runGlChecks } from './gl/gl-selftest';
import {
  QualityConfigError,
  getTier,
  validateQualityTier,
  type QualityTierName,
} from './config/quality';

const canvasElement = document.getElementById('gl-canvas');
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('Boot aborted: #gl-canvas element is missing or not a canvas');
}
// Explicit type so every later closure sees HTMLCanvasElement, never null.
const canvas: HTMLCanvasElement = canvasElement;

const context = GLContext.create(canvas);
const renderer = new CloudRenderer(context);
const hud = new Hud(handleTierSelect, handleSimulateToggle);

const viewport = new CanvasViewport(
  canvas,
  () => renderer.currentTier.resolutionScale,
  (snapshot) => hud.setViewport(snapshot),
);

// ---- Self-tests: same code path as `npm test`, rendered into the HUD. ----
const mathResults = runSelfTests();
hud.renderMathResults(mathResults);
for (const result of mathResults) {
  console.log(`[selftest:math] ${result.passed ? 'PASS' : 'FAIL'} ${result.name} — ${result.detail}`);
}

const configResults = runConfigChecks();
hud.renderConfigChecks(configResults);
for (const result of configResults) {
  console.log(`[selftest:config] ${result.passed ? 'PASS' : 'FAIL'} ${result.name} — ${result.detail}`);
}

const glChecks = runGlChecks(context);
hud.renderGlChecks(glChecks);
for (const result of glChecks) {
  console.log(`[selftest:gl] ${result.passed ? 'PASS' : 'FAIL'} ${result.name} — ${result.detail}`);
}

hud.setTier(renderer.currentTier);
hud.setResourceCount(context.registry.count);

// ---- Render loop: explicitly paused on loss, re-armed on restore. ----
let rafId = 0;
let loopRunning = false;
let lastResourceCount = -1;
let frameCount = 0;
let lastCenterPixel: readonly [number, number, number, number] = [0, 0, 0, 0];
const startTime = performance.now();

function frame(now: number): void {
  if (context.isLost) return; // belt and braces: the loop is cancelled on loss
  const timeSeconds = (now - startTime) / 1000;
  renderer.render(timeSeconds);
  frameCount += 1;

  // Sample inside the same frame task: valid even without preserveDrawingBuffer.
  const gl = context.gl;
  const px = new Uint8Array(4);
  gl.readPixels(
    Math.floor(canvas.width / 2),
    Math.floor(canvas.height / 2),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    px,
  );
  lastCenterPixel = [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, px[3] ?? 0];

  const count = context.registry.count;
  if (count !== lastResourceCount) {
    lastResourceCount = count;
    hud.setResourceCount(count);
  }
  rafId = requestAnimationFrame(frame);
}

function startLoop(): void {
  if (loopRunning || context.isLost) return;
  loopRunning = true;
  rafId = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (!loopRunning) return;
  loopRunning = false;
  cancelAnimationFrame(rafId);
}

context.onStateChange((state) => {
  hud.setContextState(state, context.canSimulateLoss);
  if (state === 'lost') {
    stopLoop();
    hud.setResourceCount(0);
  } else {
    lastResourceCount = context.registry.count;
    hud.setResourceCount(lastResourceCount);
    viewport.refresh(); // re-assert backing size against the fresh context
    startLoop();
  }
});
hud.setContextState(context.currentState, context.canSimulateLoss);
startLoop();

// ---- UI actions. ----
function handleTierSelect(name: QualityTierName): void {
  try {
    // Even built-in tiers go through the validator on every switch: the UI
    // never trusts a table entry without the single-source validation path.
    const validTier = validateQualityTier(getTier(name));
    renderer.setTier(validTier);
    hud.setTier(validTier);
    hud.clearConfigError();
    viewport.refresh(); // resolutionScale may change the backing-buffer size
  } catch (error) {
    const message =
      error instanceof QualityConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    hud.showConfigError(`档位切换被拒绝：${message}`);
    console.error('[quality] tier switch rejected', error);
  }
}

function handleSimulateToggle(): void {
  if (context.currentState === 'lost') {
    context.simulateRestore();
  } else {
    context.simulateLoss();
  }
}

function handleDebugLose(): void {
  context.simulateLoss();
}

function handleDebugRestore(): void {
  context.simulateRestore();
}

window.addEventListener('pagehide', () => {
  stopLoop();
  viewport.dispose();
  renderer.dispose();
  context.dispose();
});

// ---- Typed observation API for the headless browser smoke test. ----
// Read-only; production behavior does not depend on it.
export interface CloudDebugState {
  contextState: 'active' | 'lost';
  isContextLost: boolean;
  resourceCount: number;
  frameCount: number;
  canvasWidth: number;
  canvasHeight: number;
  clientWidth: number;
  clientHeight: number;
  dpr: number;
  centerPixel: readonly [number, number, number, number];
  tier: { name: string; raymarchSteps: number; resolutionScale: number };
}

export interface CloudDebugApi {
  getState(): CloudDebugState;
  getGlChecks(): ReturnType<typeof runGlChecks>;
  selectTier(name: QualityTierName): void;
  loseContext(): void;
  restoreContext(): void;
}

declare global {
  interface Window {
    cloudDebug?: CloudDebugApi;
  }
}

window.cloudDebug = {
  getState: (): CloudDebugState => ({
    contextState: context.currentState,
    isContextLost: context.isLost,
    resourceCount: context.registry.count,
    frameCount,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight,
    dpr: window.devicePixelRatio,
    centerPixel: lastCenterPixel,
    tier: {
      name: renderer.currentTier.name,
      raymarchSteps: renderer.currentTier.raymarchSteps,
      resolutionScale: renderer.currentTier.resolutionScale,
    },
  }),
  getGlChecks: () => runGlChecks(context),
  selectTier: handleTierSelect,
  loseContext: handleDebugLose,
  restoreContext: handleDebugRestore,
};
