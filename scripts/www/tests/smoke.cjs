#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const SCREENSHOT_DIR = path.join(ROOT, "screenshots");
const ACTION_TIMEOUT = Number(process.env.SMOKE_TIMEOUT || 10_000);

const SYSTEM_BROWSERS = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

function launchOptions() {
  const executablePath = SYSTEM_BROWSERS.find((candidate) => fs.existsSync(candidate));
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${label} should occupy visible space`);
}

async function expectDrawerOnscreen(page) {
  await page.waitForFunction(() => document.querySelector("#app")?.dataset.libraryOpen === "true", null, {
    timeout: ACTION_TIMEOUT,
  });
  await page.waitForFunction(() => {
    const drawer = document.querySelector(".left-sidebar");
    if (!drawer) return false;
    const box = drawer.getBoundingClientRect();
    return box.left >= -1 && box.right > 100 && box.width > 200;
  }, null, { timeout: ACTION_TIMEOUT });
}

async function searchOfficialApi(page) {
  const search = page.locator("#node-search");
  await page.locator('[data-catalog-kind="all"]').click();
  await search.fill("设置角色位置");
  await page.locator('[data-node-id="official.method.Actor.SetPosition"]').waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
  assert.match(await page.locator('[data-node-id="official.method.Actor.SetPosition"]').innerText(), /设置角色位置/, "official API should have a Chinese primary label");

  await search.fill("Actor.SetPosition");

  await page.waitForFunction(() => {
    const haystack = [
      document.querySelector("#node-catalog")?.textContent,
      document.querySelector("#modal-root")?.textContent,
      ...Array.from(document.querySelectorAll("[data-api-id], [data-method], [data-node-type]"), (node) =>
        [
          node.textContent,
          node.getAttribute("data-api-id"),
          node.getAttribute("data-method"),
          node.getAttribute("data-node-type"),
        ].join(" "),
      ),
    ].join(" ");
    return /Actor/i.test(haystack) && /SetPosition/i.test(haystack);
  }, null, { timeout: ACTION_TIMEOUT });

  const renderedText = await page.locator("#node-catalog").innerText();
  assert.match(renderedText, /Actor/i, "official API search should render the Actor module");
  assert.match(renderedText, /SetPosition/i, "official API search should render Actor.SetPosition");
}

async function expectNestedBlockProgram(page) {
  await expectVisible(page.locator("#canvas-content .block-program"), "nested block program");
  await expectVisible(page.locator("#canvas-content .event-cap"), "event cap");
  await expectVisible(page.locator("#canvas-content .if-frame"), "if frame");
  assert.ok(await page.locator("#canvas-content .condition-block").count() >= 2, "starter should include readable condition blocks");
  assert.ok(await page.locator("#canvas-content .then-branch .action-block").count() >= 1, "then branch should include an action");
  assert.ok(await page.locator("#canvas-content .else-branch .action-block").count() >= 1, "else branch should include an action");
  const state = await page.evaluate(() => window.MiniWorldTriggerEditor.getProject());
  const active = state.triggers.find((trigger) => trigger.id === state.activeTriggerId);
  assert.ok(active && Array.isArray(active.elseActions) && active.elseActions.length >= 1, "elseActions should persist in the project model");
  const catalogStats = await page.evaluate(() => window.MiniWorldTriggerEditor.getCatalogStats());
  assert.deepEqual(
    {
      events: catalogStats.events,
      methods: catalogStats.methods,
      componentProperties: catalogStats.componentProperties,
      globalEnumFamilies: catalogStats.globalEnumFamilies,
      globalEnumValues: catalogStats.globalEnumValues,
    },
    { events: 244, methods: 672, componentProperties: 899, globalEnumFamilies: 94, globalEnumValues: 845 },
    "the browser catalog should expose the complete verified API snapshot",
  );
}

async function selectExistingNode(page) {
  const node = page.locator("#canvas-content [data-instance-uid]").first();
  await node.click();
  const uid = await node.getAttribute("data-instance-uid");
  await page.waitForFunction((selectedUid) => {
    const selected = document.querySelector("#canvas-content [data-instance-uid].is-selected");
    const inspector = document.querySelector("#inspector-content");
    return Boolean(selected && selected.dataset.instanceUid === selectedUid && inspector?.dataset.selection === selectedUid);
  }, uid, { timeout: ACTION_TIMEOUT });
}

async function addAndSelectNode(page, mobile) {
  const nodes = page.locator("#canvas-content [data-instance-uid]");
  const before = await nodes.count();
  const candidate = page.locator('[data-node-id="official.method.Actor.SetPosition"]');
  await expectVisible(candidate, "catalog node");
  await candidate.click();
  await page.waitForFunction((previousCount) => (
    document.querySelectorAll("#canvas-content [data-instance-uid]").length > previousCount
  ), before, { timeout: ACTION_TIMEOUT });

  const after = await nodes.count();
  assert.equal(after, before + 1, "clicking a catalog item should add exactly one node");

  const added = page.locator("#canvas-content [data-instance-uid].is-selected");
  await added.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
  const addedUid = await added.getAttribute("data-instance-uid");
  await page.waitForFunction((uid) => {
    const selected = document.querySelector("#canvas-content [data-instance-uid].is-selected");
    const inspector = document.querySelector("#inspector-content");
    return Boolean(selected && selected.dataset.instanceUid === uid && inspector?.dataset.selection === uid);
  }, addedUid, { timeout: ACTION_TIMEOUT });

  if (mobile) {
    const nodeBox = await added.boundingBox();
    const canvasBox = await page.locator("#canvas").boundingBox();
    assert.ok(
      nodeBox && canvasBox && nodeBox.x < canvasBox.x + canvasBox.width && nodeBox.x + nodeBox.width > canvasBox.x,
      "a node added from the mobile drawer should appear within the canvas viewport",
    );
  }
  await page.locator("#node-search").fill("");
}

async function exerciseOutputActions(page) {
  const lua = (await page.locator("#lua-output").innerText()).trim();
  assert.ok(lua.length > 40, "generated Lua should be non-empty");
  assert.match(lua, /TriggerEvent\.|AddTriggerEvent/i, "generated Lua should register a Mini World event");
  assert.match(lua, /\bif\b[\s\S]*\bthen\b[\s\S]*\belse\b[\s\S]*\bend\b/, "generated Lua should include the visual if/else branch");

  await page.locator("#copy-lua-btn").click();
  await page.waitForTimeout(100);

  const downloadPromise = page.waitForEvent("download", { timeout: ACTION_TIMEOUT });
  await page.locator("#download-lua-btn").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.lua$/i, "Lua export should download a .lua file");
  await download.cancel().catch(() => {});
}

async function exerciseBlockedExport(page) {
  const original = await page.evaluate(() => window.MiniWorldTriggerEditor.getProject());
  const broken = structuredClone(original);
  broken.triggers[0].event = null;
  await page.evaluate((value) => window.MiniWorldTriggerEditor.setProject(value), broken);
  let downloaded = false;
  page.once("download", () => { downloaded = true; });
  await page.locator("#download-lua-btn").click();
  await page.waitForTimeout(350);
  assert.equal(downloaded, false, "Lua export should be blocked while structural errors exist");
  assert.match(await page.locator("#diagnostics").innerText(), /NO_EVENT|缺少事件/, "blocking diagnostics should explain the missing event");
  await page.evaluate((value) => window.MiniWorldTriggerEditor.setProject(value), original);
}

async function runViewport(browser, spec) {
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "zh-CN",
    viewport: spec.viewport,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT);

  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      runtimeErrors.push(`console.error: ${message.text()}${location.url ? ` (${location.url})` : ""}`);
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.stack || error.message}`));

  try {
    const response = await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: ACTION_TIMEOUT * 2 });
    assert.ok(response && response.ok(), `${BASE_URL} should return a successful document response`);
    await page.waitForFunction(() => Boolean(window.MiniWorldTriggerEditor), null, { timeout: ACTION_TIMEOUT });
    await page.locator("#canvas-content [data-instance-uid]").first().waitFor({ state: "visible", timeout: ACTION_TIMEOUT });

    await expectVisible(page.locator(".topbar"), "top toolbar");
    await expectVisible(page.locator(".canvas-panel"), "flow canvas");
    await expectVisible(page.locator(".bottom-panel"), "Lua output panel");
    await expectVisible(page.locator("#lua-output"), "Lua output");
    await expectNestedBlockProgram(page);
    await selectExistingNode(page);

    if (spec.mobile) {
      const drawer = page.locator(".left-sidebar");
      const initialBox = await drawer.boundingBox();
      assert.ok(initialBox && initialBox.x + initialBox.width <= 1, "mobile node-library drawer should start offscreen");
      await page.locator("#toggle-library-btn").click();
      await expectDrawerOnscreen(page);
    } else {
      await expectVisible(page.locator(".left-sidebar"), "node library");
      await expectVisible(page.locator("#inspector"), "inspector");
    }

    await searchOfficialApi(page);
    await addAndSelectNode(page, spec.mobile);
    await exerciseOutputActions(page);
    await exerciseBlockedExport(page);
    await page.waitForFunction(() => !document.querySelector("#toast-region .toast"), null, { timeout: 5_000 });

    await page.screenshot({
      animations: "disabled",
      fullPage: false,
      path: path.join(SCREENSHOT_DIR, `${spec.name}.png`),
    });
    assert.deepEqual(runtimeErrors, [], `${spec.name} emitted browser runtime errors:\n${runtimeErrors.join("\n")}`);
    process.stdout.write(`PASS ${spec.name} (${spec.viewport.width}x${spec.viewport.height})\n`);
  } catch (error) {
    if (runtimeErrors.length) {
      const enriched = new Error(`${error.message}\nBrowser runtime errors:\n${runtimeErrors.join("\n")}`);
      enriched.cause = error;
      throw enriched;
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch(launchOptions());
  const failures = [];
  try {
    const viewports = [
      { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
      { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
    ];
    for (const spec of viewports) {
      try {
        await runViewport(browser, spec);
      } catch (error) {
        failures.push(`${spec.name}: ${error.stack || error}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Smoke QA failures:\n\n${failures.join("\n\n")}`);
  process.stdout.write("Smoke QA completed without console errors or uncaught page errors.\n");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
