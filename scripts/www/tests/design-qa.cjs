#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const SOURCE = "C:\\Users\\XR\\AppData\\Local\\Temp\\codex-clipboard-e58294a9-12ba-44d2-8be4-39f2c0147068.png";
const OUTPUT_DIR = path.join(ROOT, "screenshots");
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

async function main() {
  if (!fs.existsSync(SOURCE)) throw new Error(`Reference image not found: ${SOURCE}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1068, height: 670 } });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.MiniWorldTriggerEditor));
    await page.locator("#canvas-content .block-program").waitFor({ state: "visible" });
    await page.screenshot({ animations: "disabled", path: path.join(OUTPUT_DIR, "qa-viewport.png") });
    const programMarkup = await page.locator("#canvas-content .block-program").evaluate((element) => element.outerHTML);
    const isolated = await context.newPage();
    await isolated.setViewportSize({ width: 900, height: 1000 });
    await isolated.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${BASE_URL}/styles.css"><style>
        html,body{margin:0;min-height:100%;background:#071a30}
        #canvas-content.block-program{position:relative!important;inset:auto!important;width:820px!important;min-height:0!important;height:auto!important;padding:20px!important;overflow:visible!important}
        #canvas-content.block-program>.block-program{width:100%!important;background:#071a30;padding:0 0 18px!important}
      </style></head><body><div id="canvas-content" class="canvas-content block-program">${programMarkup}</div></body></html>`, { waitUntil: "networkidle" });
    await isolated.locator("#canvas-content > .block-program").screenshot({
      animations: "disabled",
      path: path.join(OUTPUT_DIR, "focused-program.png"),
    });
    await isolated.close();
    if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);

    const reference = fs.readFileSync(SOURCE).toString("base64");
    const implementation = fs.readFileSync(path.join(OUTPUT_DIR, "focused-program.png")).toString("base64");
    const board = await context.newPage();
    await board.setViewportSize({ width: 2200, height: 760 });
    await board.setContent(`<!doctype html>
      <html lang="zh-CN"><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;padding:24px;background:#03101f;color:#dff7ff;font-family:"Microsoft YaHei UI",sans-serif}
        main{display:grid;grid-template-columns:1fr 1fr;gap:16px;height:712px}.card{display:grid;grid-template-rows:36px 1fr;min-width:0;overflow:hidden;border:1px solid #173955;border-radius:12px;background:#071a30;box-shadow:0 14px 40px #0008}
        header{display:flex;align-items:center;padding:0 14px;border-bottom:1px solid #173955;background:#0a2440;font-size:14px;font-weight:700}.stage{display:grid;place-items:center;min-height:0;padding:10px;background:#101d39;overflow:hidden}
        img{display:block;max-width:100%;max-height:100%;object-fit:contain}
      </style></head><body><main>
        <section class="card"><header>参考结构</header><div class="stage"><img src="data:image/png;base64,${reference}"></div></section>
        <section class="card"><header>当前实现</header><div class="stage"><img src="data:image/png;base64,${implementation}"></div></section>
      </main></body></html>`, { waitUntil: "load" });
    await board.screenshot({ animations: "disabled", path: path.join(OUTPUT_DIR, "design-comparison.png") });
    await context.close();
    process.stdout.write("PASS design comparison artifacts created\n");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
