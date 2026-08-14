#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = ["api-reference.js", "api-catalog.js", "app.js", "liquid-glass.js"];
let referenceSource = "";

for (const file of scripts) {
  const source = await readFile(resolve(root, file), "utf8");
  new Script(source, { filename: file });
  if (file === "api-reference.js") referenceSource = source;
  console.log(`syntax ok  ${file}`);
}

const sandbox = { window: {} };
new Script(referenceSource, { filename: "api-reference.js" }).runInNewContext(sandbox);
const reference = sandbox.window.MINIWORLD_OFFICIAL_API;
assert.ok(reference, "official API snapshot should initialize");
assert.equal(reference.stats.methods, 672, "verified callable snapshot count changed");
assert.equal(reference.stats.events, 244, "verified event snapshot count changed");
assert.equal(reference.stats.componentProperties, 899, "stable component property count changed");
assert.equal(reference.stats.internalComponentProperties, 8, "internal component property count changed");
assert.equal(reference.stats.globalEnumFamilies, 94, "global enum family count changed");
assert.equal(reference.stats.globalEnumValues, 845, "global enum value count changed");
for (const [name, values] of [
  ["methods", reference.methods],
  ["events", reference.events],
  ["componentProperties", reference.componentProperties],
  ["globalEnums", reference.globalEnums],
]) {
  assert.equal(new Set(values.map((entry) => entry.id)).size, values.length, `${name} contains duplicate IDs`);
}
assert.ok(reference.componentProperties.some((entry) => entry.id === "GunEdit.gunType"));
assert.ok(reference.componentProperties.some((entry) => entry.id === "OldGunEdit.gunType"));
assert.equal(reference.globalEnums.filter((entry) => entry.enum === "AvtPart").length, 30);
console.log("snapshot ok official UGC 3.0 reference counts and IDs");

const html = await readFile(resolve(root, "index.html"), "utf8");
for (const required of ["api-reference.js", "api-catalog.js", "app.js", "liquid-glass.js"]) {
  if (!html.includes(required)) throw new Error(`index.html is missing ${required}`);
}
for (const id of ["node-catalog", "canvas", "liquid-glass-layer", "inspector-content", "lua-output", "diagnostics"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`index.html is missing #${id}`);
}
const appScriptIndex = html.indexOf('src="app.js"');
const glassScriptIndex = html.indexOf('src="liquid-glass.js"');
assert.ok(appScriptIndex >= 0 && glassScriptIndex > appScriptIndex, "liquid-glass.js should load after app.js");
const glassCanvas = html.match(/<canvas\b[^>]*\bid=["']liquid-glass-layer["'][^>]*>/i)?.[0];
assert.ok(glassCanvas, "index.html should include the liquid-glass canvas");
assert.match(glassCanvas, /\baria-hidden=["']true["']/i, "liquid-glass canvas should be hidden from assistive technology");
const canvasStart = html.indexOf('id="canvas"');
const glassCanvasIndex = html.indexOf('id="liquid-glass-layer"');
const viewportIndex = html.indexOf('id="canvas-viewport"');
assert.ok(
  canvasStart >= 0 && glassCanvasIndex > canvasStart && viewportIndex > glassCanvasIndex,
  "liquid-glass canvas should be mounted between #canvas and #canvas-viewport",
);
console.log("markup ok  index.html");
