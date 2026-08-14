#!/usr/bin/env node

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const client = resolve(dist, "client");
const webFiles = [
  "index.html",
  "styles.css",
  "api-reference.js",
  "api-catalog.js",
  "app.js",
  "liquid-glass.js",
  "THIRD_PARTY_NOTICES.md",
  "LIQUID_GLASS_LICENSE.txt",
];

await rm(dist, { force: true, recursive: true });
await mkdir(client, { recursive: true });

for (const file of webFiles) {
  const source = resolve(root, file);
  await stat(source);
  await cp(source, resolve(client, file));
}

const worker = resolve(root, "worker", "index.js");
await stat(worker);
await mkdir(resolve(dist, "server"), { recursive: true });
await cp(worker, resolve(dist, "server", "index.js"));

const hosting = resolve(root, ".openai", "hosting.json");
try {
  await stat(hosting);
  await mkdir(resolve(dist, ".openai"), { recursive: true });
  await cp(hosting, resolve(dist, ".openai", "hosting.json"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(`Built ${webFiles.length} client files and the Sites worker into ${dist}`);
