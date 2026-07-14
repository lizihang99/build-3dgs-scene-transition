import { chromium } from "playwright";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startDevServer, stopDevServer } from "./support/devServer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const port = Number(process.env.VRMUSIC_TRANSITION_DUST_PORT ?? 47000 + (process.pid % 10000));
const baseUrl = `https://127.0.0.1:${port}`;
const musicPath = resolve(appDir, "public/audio/cipher-kevin-macleod.ogg");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 404) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Vite server did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function pollPage(page, evaluateFn, timeoutMs, label, intervalMs = 120, evaluateArg) {
  const start = Date.now();
  let lastValue;
  while (Date.now() - start < timeoutMs) {
    lastValue = await page.evaluate(evaluateFn, evaluateArg);
    if (lastValue && typeof lastValue === "object" && lastValue.__pending === true) {
      await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
      continue;
    }
    if (lastValue) return lastValue;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  throw new Error(`${label}: ${JSON.stringify(lastValue)}`);
}

async function assertActionFits(page, label) {
  await assertElementFits(page, "[data-demo-action]", `${label} action control`);
}

async function assertElementFits(page, selector, label) {
  const bounds = await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight
    };
  }, selector);
  assert(bounds, `${label} is missing`);
  assert(bounds.left >= 0 && bounds.top >= 0, `${label} starts outside the viewport: ${JSON.stringify(bounds)}`);
  assert(
    bounds.right <= bounds.viewportWidth + 0.5 && bounds.bottom <= bounds.viewportHeight + 0.5,
    `${label} overflows the viewport: ${JSON.stringify(bounds)}`
  );
}

const server = startDevServer(appDir, port);
assert(statSync(musicPath).size > 1_000_000, "demo must include the full licensed music track, not a test tone");
const serverLog = [];
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => serverLog.push(String(chunk)));
}

let browser;
try {
  await waitForServer(baseUrl);
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--ignore-certificate-errors"]
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(`${baseUrl}/transition-dust-demo.html?autoplay=0&releaseDuration=0.55&enterDuration=2.2&count=600`, { waitUntil: "domcontentloaded" });
  await pollPage(
    page,
    () => typeof window.__transitionDustDemo === "object",
    5_000,
    "transition dust demo debug contract is missing"
  );
  const ready = await pollPage(
    page,
    () => {
      const api = window.__transitionDustDemo;
      if (!api) return false;
      const state = api.state();
      return state.ready && state.oldSplats > 0 && state.newSplats > 0 ? state : false;
    },
    60_000,
    "transition dust demo did not expose a ready debug contract"
  );
  assert(ready.dustCount >= 600, `demo should allocate a meaningful transition field: ${JSON.stringify(ready)}`);
  assert(ready.dustPrimitive === "gsplat", `transition particles must use the same Gaussian primitive as 3DGS: ${JSON.stringify(ready)}`);
  assert(ready.audioReactive === true && ready.audioTrack === "Cipher", `demo should expose the real FFT-reactive track: ${JSON.stringify(ready)}`);
  assert(ready.flowState === "STANDBY" && ready.playing === false, `autoplay=0 should await the first action: ${JSON.stringify(ready)}`);
  assert(ready.revealMode === "center-bloom", `default reveal mode should be center bloom: ${JSON.stringify(ready)}`);
  assert(ready.revealProgress === 0, `incoming reveal should start collapsed: ${JSON.stringify(ready)}`);
  const outgoingPixels = await pollPage(
    page,
    () => {
      const stats = window.__transitionDustDemo.pixelStats();
      return stats.luminanceStdDev > 4 ? stats : { __pending: true, ...stats };
    },
    10_000,
    "Outgoing 3DGS did not produce a non-uniform scene image"
  );
  assert(outgoingPixels.luminanceStdDev > 4, `Outgoing 3DGS appears blank: ${JSON.stringify(outgoingPixels)}`);
  await assertActionFits(page, "desktop");
  await assertElementFits(page, "#reveal-mode-ui", "desktop reveal mode control");
  const initialButton = await page.evaluate(() => document.querySelector("#action-button")?.textContent ?? null);
  assert(initialButton?.includes("释放粒子"), `first action should release particles: ${initialButton}`);
  await page.evaluate(() => document.querySelector('[data-reveal-mode="gather"]')?.click());
  const gatherMode = await page.evaluate(() => window.__transitionDustDemo.state());
  assert(gatherMode.revealMode === "gather", `reveal mode control should switch to gather: ${JSON.stringify(gatherMode)}`);
  await page.evaluate(() => document.querySelector('[data-reveal-mode="center-bloom"]')?.click());
  const centerMode = await page.evaluate(() => window.__transitionDustDemo.state());
  assert(centerMode.revealMode === "center-bloom", `reveal mode control should switch back to center bloom: ${JSON.stringify(centerMode)}`);

  const release = await page.evaluate(() => {
    document.querySelector("#action-button")?.click();
    return window.__transitionDustDemo.state();
  });
  assert(release.flowState === "LOADING" && release.playing, `first action did not start the release: ${JSON.stringify(release)}`);
  assert(release.oldVisible === true && release.newVisible === false, `Release visibility is wrong: ${JSON.stringify(release)}`);

  const hold = await pollPage(
    page,
    () => {
      const state = window.__transitionDustDemo.state();
      return state.flowState === "READY" ? state : { __pending: true, ...state };
    },
    5_000,
    "first action did not stop at the ready cloud"
  );
  assert(hold.phase === "hold", `ready state should remain in Hold: ${JSON.stringify(hold)}`);
  assert(hold.oldVisible === false && hold.newVisible === false, `Hold must contain no 3DGS: ${JSON.stringify(hold)}`);
  assert(hold.dustOpacity >= 0.7, `Hold dust should carry the frame: ${JSON.stringify(hold)}`);
  assert(hold.dustMotionModel === "spectral-filament", `Hold should use the audio-reactive spectral filament flow: ${JSON.stringify(hold)}`);
  assert(Number.isInteger(hold.dustVersion), `Hold should expose its generated GSplat version: ${JSON.stringify(hold)}`);
  const readyButton = await page.evaluate(() => document.querySelector("#action-button")?.textContent ?? null);
  assert(readyButton?.includes("进入空间"), `second action should enter the scene: ${readyButton}`);
  const holdPixels = await pollPage(
    page,
    () => {
      const stats = window.__transitionDustDemo.pixelStats();
      return stats.nonDarkFraction > 0.005 ? stats : { __pending: true, ...stats };
    },
    10_000,
    "Hold GSplat field did not render visible pixels"
  );
  assert(holdPixels.averageLuminance > 2, `Hold canvas is too dark: ${JSON.stringify(holdPixels)}`);
  assert(holdPixels.nonDarkFraction > 0.005, `Hold canvas appears blank: ${JSON.stringify(holdPixels)}`);

  const movingDust = await pollPage(
    page,
    (baseline) => {
      const state = window.__transitionDustDemo.state();
      return state.progress === baseline.progress && state.dustVersion > baseline.version
        ? state
        : { __pending: true, ...state };
    },
    5_000,
    "Hold GSplats did not keep moving while waiting for the second action",
    120,
    { progress: hold.progress, version: hold.dustVersion }
  );
  assert(movingDust.phase === "hold", `Hold flow advanced while waiting: ${JSON.stringify(movingDust)}`);

  const enteringStart = await page.evaluate(() => {
    document.querySelector("#action-button")?.click();
    return window.__transitionDustDemo.state();
  });
  assert(enteringStart.flowState === "ENTERED" && enteringStart.playing, `second action did not start entering: ${JSON.stringify(enteringStart)}`);
  assert(enteringStart.dustSurge > 0.05, `second action did not trigger the forward surge: ${JSON.stringify(enteringStart)}`);
  assert(enteringStart.oldVisible === false && enteringStart.newVisible === false, `surge should precede the new scene reveal: ${JSON.stringify(enteringStart)}`);
  assert(enteringStart.revealMode === "center-bloom" && enteringStart.revealProgress === 0, `forward surge should happen before center bloom reveal: ${JSON.stringify(enteringStart)}`);
  const uiHidden = await page.evaluate(() => document.querySelector("#action-ui")?.getAttribute("data-hidden") ?? null);
  assert(uiHidden === "true", `action UI should fade out after entering: ${uiHidden}`);
  const revealLocked = await page.evaluate(() => document.querySelector("#reveal-mode-ui")?.getAttribute("data-locked") ?? null);
  assert(revealLocked === "true", `reveal mode control should lock during enter: ${revealLocked}`);

  await page.evaluate(() => window.__transitionDustDemo.seek(0.8125));
  await page.waitForTimeout(100);
  const blooming = await page.evaluate(() => ({
    state: window.__transitionDustDemo.state(),
    pixels: window.__transitionDustDemo.pixelStats()
  }));
  assert(
    blooming.state.flowState === "ENTERED" &&
      blooming.state.newVisible &&
      blooming.state.revealMode === "center-bloom" &&
      blooming.state.revealProgress > 0.45 &&
      blooming.state.revealProgress < 0.55,
    `center bloom did not reveal the incoming 3DGS at mid-progress: ${JSON.stringify(blooming)}`
  );
  assert(blooming.pixels.luminanceStdDev > 2.5, `Center bloom frame appears flat: ${JSON.stringify(blooming)}`);
  assert(blooming.pixels.nonDarkFraction > 0.002, `Center bloom frame appears blank: ${JSON.stringify(blooming)}`);

  const settled = await page.evaluate(() => window.__transitionDustDemo.seek(1));
  assert(settled.phase === "settled", `1.0 should be Settled: ${JSON.stringify(settled)}`);
  assert(settled.oldVisible === false && settled.newVisible === true, `Settled visibility is wrong: ${JSON.stringify(settled)}`);
  assert(settled.dustOpacity < 0.01, `Settled dust should be gone: ${JSON.stringify(settled)}`);
  assert(settled.revealMode === "center-bloom" && settled.revealProgress === 1, `Settled center bloom state is wrong: ${JSON.stringify(settled)}`);
  const incomingPixels = await pollPage(
    page,
    () => {
      const stats = window.__transitionDustDemo.pixelStats();
      return stats.luminanceStdDev > 4 ? stats : { __pending: true, ...stats };
    },
    10_000,
    "Settled incoming 3DGS did not produce a non-uniform scene image"
  );
  assert(incomingPixels.luminanceStdDev > 4, `Incoming 3DGS appears blank: ${JSON.stringify(incomingPixels)}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__transitionDustDemo.seek(0));
  await assertActionFits(page, "mobile");
  await assertElementFits(page, "#reveal-mode-ui", "mobile reveal mode control");

  assert(consoleErrors.length === 0, `browser console errors:\n${consoleErrors.join("\n")}`);
  console.log("transition-dust-demo-contract PASS");
} catch (error) {
  console.error(error);
  if (serverLog.length) console.error(serverLog.join(""));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopDevServer(server);
}
