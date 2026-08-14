#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const ACTION_TIMEOUT = Number(process.env.SMOKE_TIMEOUT || 10_000);
const SYSTEM_BROWSERS = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const VIEWPORTS = [
  {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    mobile: false,
    maxDpr: 1.5,
    maxBufferPixels: 1_700_000,
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 },
    mobile: true,
    maxDpr: 1.05,
    maxBufferPixels: 1_500_000,
  },
];

function launchOptions() {
  const executablePath = SYSTEM_BROWSERS.find((candidate) => fs.existsSync(candidate));
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

function urlFor(mode) {
  const url = new URL(BASE_URL);
  if (mode) url.searchParams.set("glass", mode);
  return url.href;
}

function collectRuntimeErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      errors.push(`console.error: ${message.text()}${location.url ? ` (${location.url})` : ""}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack || error.message}`));
  return errors;
}

async function waitForEditorAndGlass(page) {
  await page.waitForFunction(() => Boolean(window.MiniWorldTriggerEditor), null, { timeout: ACTION_TIMEOUT });
  await page.waitForFunction(() => {
    const app = document.querySelector("#app");
    const canvas = document.querySelector("#canvas");
    return app?.dataset.glassReady === "true" && canvas?.dataset.glassReady === "true";
  }, null, { timeout: ACTION_TIMEOUT });
  await page.locator("#canvas-content [data-instance-uid]").first().waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
}

async function assertGlassContract(page, expectedMode, spec) {
  const state = await page.evaluate(() => {
    const app = document.querySelector("#app");
    const host = document.querySelector("#canvas");
    const layer = document.querySelector("#liquid-glass-layer");
    const api = window.MiniWorldLiquidGlass;
    return {
      appMode: app?.dataset.glassMode,
      appReady: app?.dataset.glassReady,
      hostMode: host?.dataset.glassMode,
      hostReady: host?.dataset.glassReady,
      layerCount: document.querySelectorAll("#liquid-glass-layer").length,
      ariaHidden: layer?.getAttribute("aria-hidden"),
      pointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
      diagnostics: api && typeof api.getDiagnostics === "function" ? api.getDiagnostics() : null,
    };
  });

  assert.equal(state.appReady, "true", "#app should expose the ready glass state");
  assert.equal(state.hostReady, "true", "#canvas should expose the ready glass state");
  assert.equal(state.appMode, expectedMode, `#app should enter ${expectedMode} mode`);
  assert.equal(state.hostMode, expectedMode, "#canvas and #app should agree on the glass mode");
  assert.equal(state.layerCount, 1, "the enhancement should mount exactly one glass canvas");
  assert.equal(state.ariaHidden, "true", "the decorative glass canvas should be hidden from assistive technology");
  assert.equal(state.pointerEvents, "none", "the decorative glass canvas must not intercept input");
  assert.ok(state.diagnostics && typeof state.diagnostics === "object", "the glass layer should expose diagnostics");
  assert.equal(state.diagnostics.mode, expectedMode, "diagnostics should report the active mode");

  if (expectedMode === "webgl") {
    assert.ok(Number.isFinite(state.diagnostics.frames) && state.diagnostics.frames >= 1, "WebGL should render at least one frame");
    assert.ok(Number.isFinite(state.diagnostics.dpr) && state.diagnostics.dpr > 0, "WebGL should report a positive DPR");
    assert.ok(state.diagnostics.dpr <= spec.maxDpr, `DPR should stay within the ${spec.name} performance cap`);
    assert.ok(
      Number.isFinite(state.diagnostics.bufferPixels) && state.diagnostics.bufferPixels > 0,
      "WebGL should report its drawing-buffer pixel count",
    );
    assert.ok(
      state.diagnostics.bufferPixels <= spec.maxBufferPixels,
      `${spec.name} drawing buffer should stay below ${spec.maxBufferPixels.toLocaleString()} pixels`,
    );
    assert.ok(Number.isFinite(state.diagnostics.initMs) && state.diagnostics.initMs >= 0, "WebGL should report initialization time");
  }
}

async function exerciseCoreInteractions(page, mobile) {
  const firstNode = page.locator("#canvas-content [data-instance-uid]").first();
  await firstNode.scrollIntoViewIfNeeded();
  const hitTarget = await firstNode.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  });
  assert.equal(hitTarget, true, "hit testing should pass through the decorative glass canvas");

  await firstNode.click();
  const selectedUid = await firstNode.getAttribute("data-instance-uid");
  await page.waitForFunction((uid) => (
    document.querySelector("#canvas-content [data-instance-uid].is-selected")?.dataset.instanceUid === uid
  ), selectedUid, { timeout: ACTION_TIMEOUT });

  if (mobile) {
    await page.locator("#toggle-library-btn").click();
    await page.waitForFunction(() => document.querySelector("#app")?.dataset.libraryOpen === "true", null, {
      timeout: ACTION_TIMEOUT,
    });
  }

  const search = page.locator("#node-search");
  await search.fill("Actor.SetPosition");
  const candidate = page.locator('[data-node-id="official.method.Actor.SetPosition"]');
  await candidate.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
  const before = await page.locator("#canvas-content [data-instance-uid]").count();
  await candidate.click();
  await page.waitForFunction((count) => (
    document.querySelectorAll("#canvas-content [data-instance-uid]").length === count + 1
  ), before, { timeout: ACTION_TIMEOUT });
  await search.fill("");

  if (mobile && await page.locator("#app").getAttribute("data-library-open") === "true") {
    await page.locator("#toggle-library-btn").click();
  }

  const scrollMetrics = await page.locator("#canvas-content").evaluate((content) => {
    content.scrollTop = 0;
    return { max: Math.max(0, content.scrollHeight - content.clientHeight), top: content.scrollTop };
  });
  if (scrollMetrics.max > 1) {
    await page.locator("#canvas-content").hover();
    await page.mouse.wheel(0, Math.min(180, scrollMetrics.max));
    await page.waitForFunction(() => document.querySelector("#canvas-content")?.scrollTop > 0, null, {
      timeout: ACTION_TIMEOUT,
    });
  }
}

async function runModeCase(browser, spec, mode, expectedMode) {
  const context = await browser.newContext({ locale: "zh-CN", viewport: spec.viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT);
  const runtimeErrors = collectRuntimeErrors(page);
  try {
    const response = await page.goto(urlFor(mode), { waitUntil: "networkidle", timeout: ACTION_TIMEOUT * 2 });
    assert.ok(response?.ok(), `${urlFor(mode)} should return a successful document response`);
    await waitForEditorAndGlass(page);
    await assertGlassContract(page, expectedMode, spec);
    await exerciseCoreInteractions(page, spec.mobile);
    await page.waitForTimeout(120);
    assert.deepEqual(runtimeErrors, [], `${spec.name}/${expectedMode} emitted browser runtime errors:\n${runtimeErrors.join("\n")}`);
    process.stdout.write(`PASS ${spec.name}/${expectedMode}\n`);
  } finally {
    await context.close();
  }
}

async function runReducedMotionCase(browser, hasWebGL) {
  const spec = VIEWPORTS[0];
  const context = await browser.newContext({
    locale: "zh-CN",
    reducedMotion: "reduce",
    viewport: spec.viewport,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT);
  const runtimeErrors = collectRuntimeErrors(page);
  try {
    await page.goto(urlFor(hasWebGL ? undefined : "fallback"), { waitUntil: "networkidle", timeout: ACTION_TIMEOUT * 2 });
    await waitForEditorAndGlass(page);
    const before = await page.evaluate(() => window.MiniWorldLiquidGlass.getDiagnostics());
    await page.waitForTimeout(750);
    const after = await page.evaluate(() => window.MiniWorldLiquidGlass.getDiagnostics());
    assert.ok(after.frames - before.frames <= 1, "reduced-motion mode should render a static frame rather than continuously animate");
    if (after.mode === "webgl") assert.equal(after.paused, true, "reduced-motion WebGL should report a paused renderer");
    assert.deepEqual(runtimeErrors, [], `reduced-motion emitted browser runtime errors:\n${runtimeErrors.join("\n")}`);
    process.stdout.write(`PASS reduced-motion/${after.mode}\n`);
  } finally {
    await context.close();
  }
}

async function detectWebGL(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      return Boolean(gl);
    });
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch(launchOptions());
  const failures = [];
  try {
    const hasWebGL = await detectWebGL(browser);
    for (const spec of VIEWPORTS) {
      if (hasWebGL) {
        try {
          await runModeCase(browser, spec, undefined, "webgl");
        } catch (error) {
          failures.push(`${spec.name}/webgl: ${error.stack || error}`);
        }
      } else {
        process.stdout.write(`SKIP ${spec.name}/webgl: browser does not provide a WebGL context\n`);
      }
      try {
        await runModeCase(browser, spec, "fallback", "css-fallback");
      } catch (error) {
        failures.push(`${spec.name}/css-fallback: ${error.stack || error}`);
      }
    }
    try {
      await runReducedMotionCase(browser, hasWebGL);
    } catch (error) {
      failures.push(`reduced-motion: ${error.stack || error}`);
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Liquid-glass smoke failures:\n\n${failures.join("\n\n")}`);
  process.stdout.write("Liquid-glass smoke QA completed without console errors or uncaught page errors.\n");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
