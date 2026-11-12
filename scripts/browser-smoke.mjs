#!/usr/bin/env node
/**
 * Headless browser smoke test for the foundation layer.
 * Drives the REAL app over http via puppeteer-core + system Chrome:
 *   1. boots with no console/page errors, WebGL2 active, 3 tracked resources;
 *   2. frames are produced and the framebuffer contains rendered pixels;
 *   3. backing buffer always equals round(cssSize * dpr * resolutionScale);
 *   4. continuous ResizeObserver resizes keep the invariant (no stretching);
 *   5. devicePixelRatio override (1 -> 2 -> 1) resizes the buffer correctly;
 *   6. quality-tier switches inject the single-source parameters;
 *   7. WEBGL_lose_context: loop pauses, resources drop, HUD shows "lost";
 *   8. context restore: resources rebuild to the same count and frames resume.
 *
 * Run via `npm run test:browser` (builds first, then starts vite preview).
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const PORT = 4317;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 4000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

async function startPreviewServer() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let started = false;
  server.stdout.on('data', (chunk) => {
    if (chunk.toString().includes(String(PORT))) started = true;
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !started) await sleep(100);
  if (!started) {
    server.kill();
    throw new Error('vite preview did not start in time');
  }
  return server;
}

async function main() {
  const server = await startPreviewServer();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
      ],
      defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`uncaught: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

    const getState = async () => page.evaluate(async () => await window.cloudDebug.getState());
    const expectInvariant = async (label) => {
      const state = await getState();
      const expectedW = Math.round(state.clientWidth * state.dpr * state.tier.resolutionScale);
      const expectedH = Math.round(state.clientHeight * state.dpr * state.tier.resolutionScale);
      const ok =
        state.canvasWidth === expectedW &&
        state.canvasHeight === expectedH &&
        state.canvasWidth > 0 &&
        state.canvasHeight > 0;
      check(
        `缓冲尺寸不变式 [${label}]`,
        ok,
        `buffer=${state.canvasWidth}x${state.canvasHeight}, expected=${expectedW}x${expectedH}, css=${state.clientWidth}x${state.clientHeight}, dpr=${state.dpr}, scale=${state.tier.resolutionScale}`,
      );
      return state;
    };

    // 1. boot state
    await waitFor(async () => (await getState()).contextState === 'active');
    const initial = await getState();
    check('WebGL2 上下文 active', initial.contextState === 'active' && !initial.isContextLost);
    check('登记 3 个 GPU 资源 (program/vbo/vao)', initial.resourceCount === 3, `count=${initial.resourceCount}`);
    check('默认档位 balanced/96/1', initial.tier.name === 'balanced' && initial.tier.raymarchSteps === 96 && initial.tier.resolutionScale === 1);

    // 2. frames + real pixels
    await sleep(400);
    const afterFrames = await getState();
    check('渲染循环持续出帧', afterFrames.frameCount > 10, `frames=${afterFrames.frameCount}`);
    const [r, g, b, a] = afterFrames.centerPixel;
    check('帧缓冲含已渲染像素（非全黑，alpha=255）', a === 255 && Math.max(r, g, b) > 15, `rgba=(${r},${g},${b},${a})`);

    // 3. initial invariant
    await expectInvariant('初始');

    // 4. continuous resizes
    await page.setViewport({ width: 1000, height: 600 });
    await sleep(150);
    await page.setViewport({ width: 1450, height: 900 });
    await sleep(150);
    await page.setViewport({ width: 900, height: 500 });
    await sleep(250);
    const resized = await expectInvariant('连续 resize 后');
    check('连续 resize 后仍在出帧', resized.frameCount > afterFrames.frameCount, `frames=${resized.frameCount}`);

    // 5. DPR changes
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 500, deviceScaleFactor: 2, mobile: false });
    await sleep(300);
    const dpr2 = await getState();
    check('DPR 切换为 2 被观测到', dpr2.dpr === 2, `dpr=${dpr2.dpr}`);
    await expectInvariant('dpr=2');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 500, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const dpr1 = await getState();
    check('DPR 恢复为 1', dpr1.dpr === 1);
    await expectInvariant('dpr=1 恢复');

    // 6. tier switches
    await page.evaluate(() => window.cloudDebug.selectTier('smooth'));
    await sleep(250);
    const smooth = await getState();
    check('切到 smooth：参数 48 / 0.75 注入', smooth.tier.raymarchSteps === 48 && smooth.tier.resolutionScale === 0.75);
    await expectInvariant('smooth 缩放 0.75');
    await page.evaluate(() => window.cloudDebug.selectTier('ultra'));
    await sleep(250);
    const ultra = await getState();
    check('切到 ultra：参数 192 / 1.0 注入', ultra.tier.raymarchSteps === 192 && ultra.tier.resolutionScale === 1);
    await expectInvariant('ultra 缩放 1.0');

    // 7. context loss
    const framesBeforeLoss = (await getState()).frameCount;
    await page.evaluate(() => window.cloudDebug.loseContext());
    await waitFor(async () => (await getState()).contextState === 'lost');
    await sleep(350);
    const lost = await getState();
    check('丢失后状态为 lost 且 isContextLost=true', lost.contextState === 'lost' && lost.isContextLost);
    check('丢失后渲染循环暂停（帧数冻结）', lost.frameCount === framesBeforeLoss, `before=${framesBeforeLoss}, after=${lost.frameCount}`);
    check('丢失后 GPU 资源引用全部释放', lost.resourceCount === 0, `count=${lost.resourceCount}`);
    const hudStateText = await page.$eval('#hud-context-state', (el) => el.textContent);
    check('HUD 显示上下文丢失状态', typeof hudStateText === 'string' && hudStateText.includes('lost'), `text="${hudStateText}"`);

    // 8. restore
    await page.evaluate(() => window.cloudDebug.restoreContext());
    await waitFor(async () => (await getState()).contextState === 'active');
    await sleep(400);
    const restored = await getState();
    check('恢复后状态回到 active', restored.contextState === 'active' && !restored.isContextLost);
    check('恢复后资源重建为 3 个', restored.resourceCount === 3, `count=${restored.resourceCount}`);
    check('恢复后渲染循环继续出帧', restored.frameCount > framesBeforeLoss, `frames=${restored.frameCount}`);
    const [rr, rg, rb, ra] = restored.centerPixel;
    check('恢复后帧缓冲重新含像素', ra === 255 && Math.max(rr, rg, rb) > 15, `rgba=(${rr},${rg},${rb},${ra})`);
    await expectInvariant('恢复后');
    const hudAfter = await page.$eval('#hud-context-state', (el) => el.textContent);
    check('HUD 恢复显示 active', typeof hudAfter === 'string' && hudAfter.includes('active'), `text="${hudAfter}"`);

    // 9. self-test panels rendered
    const mathItems = await page.$$eval('#hud-selftest li', (nodes) => nodes.map((n) => n.className));
    check('HUD 数学自测 4 项全部 pass', mathItems.length === 4 && mathItems.every((c) => c === 'pass'), `classes=${mathItems.join(',')}`);
    const configItems = await page.$$eval('#hud-config-checks li', (nodes) => nodes.map((n) => n.className));
    check('HUD 配置校验 11 项全部 pass', configItems.length === 11 && configItems.every((c) => c === 'pass'), `count=${configItems.length}`);

    // 10. GL tool-layer self-tests (rich shader errors + dispose lifecycle)
    const glChecks = await page.evaluate(async () => await window.cloudDebug.getGlChecks());
    for (const result of glChecks) {
      check(`[GL自测] ${result.name}`, result.passed, result.detail);
    }

    check(
      '全程无 console error / 未捕获异常 / 失败请求',
      consoleErrors.length === 0 && failedRequests.length === 0,
      [...consoleErrors, ...failedRequests].join(' | '),
    );

    await browser.close();
  } finally {
    server.kill();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`Browser smoke test FAILED: ${failures.length} check(s): ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('Browser smoke test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
