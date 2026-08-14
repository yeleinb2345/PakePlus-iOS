#!/usr/bin/env node

/**
 * Build an offline, searchable snapshot of the public Mini World UGC 3.0 API.
 *
 * The editor itself never needs network access. Re-run this script when the
 * official wiki changes, then review and commit the generated api-reference.js.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(HERE, "..", "api-reference.js");
const ORIGIN = "https://dev-wiki.mini1.cn";
const INDEX_URL = `${ORIGIN}/ugc-wiki/apis/triggerevent.html`;
const EXTRA_URLS = [
  `${ORIGIN}/ugc-wiki/apis/cloudsever.html`,
  `${ORIGIN}/ugc-wiki/apis/componentevent.html`,
  `${ORIGIN}/ugc-wiki/introduction/componentapi.html`,
  `${ORIGIN}/ugc-wiki/introduction/globalfunc.html`,
  `${ORIGIN}/ugc-wiki/introduction/obj.html`,
  `${ORIGIN}/ugc-wiki/data_files/componentwiki.html`,
];
const COMPONENT_WIKI_URL = `${ORIGIN}/ugc-wiki/data_files/componentwiki.html`;

const entityMap = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (full, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return entityMap[entity.toLowerCase()] ?? full;
  });
}

function text(value = "") {
  return decodeEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function label(value) {
  return text(value).replace(/\u200b/g, "").trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "MiniFlow-API-Snapshot/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
}

function sectionById(html, id) {
  const marker = new RegExp(`<h[23][^>]+id=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i");
  const match = marker.exec(html);
  if (!match) return "";
  const rest = html.slice(match.index + match[0].length);
  const next = rest.search(/<h[23][^>]+id=["'][^"']+["'][^>]*>/i);
  return next < 0 ? rest : rest.slice(0, next);
}

function listAfterLabel(section, label, stopLabel) {
  const start = section.indexOf(label);
  if (start < 0) return [];
  const stop = stopLabel ? section.indexOf(stopLabel, start + label.length) : -1;
  const fragment = section.slice(start, stop < 0 ? undefined : stop);
  const ulStart = fragment.indexOf("<ul");
  if (ulStart < 0) return [];
  const ulEnd = fragment.indexOf("</ul>", ulStart);
  const list = fragment.slice(ulStart, ulEnd < 0 ? undefined : ulEnd + 5);
  return unique([...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => text(item[1])));
}

function detailsAfterLabel(section, label, stopLabel) {
  const nested = listAfterLabel(section, label, stopLabel);
  if (nested.length) return nested.filter((entry) => entry !== "无");
  const start = section.indexOf(label);
  if (start < 0) return [];
  const stop = stopLabel ? section.indexOf(stopLabel, start + label.length) : -1;
  const plain = text(section.slice(start + label.length, stop < 0 ? undefined : stop))
    .replace(/^[：:\s]+/, "")
    .replace(/[；;\s]+$/, "");
  if (!plain || plain === "无") return [];
  return plain.split(/\s*[,，]\s*(?=[A-Za-z_]\w*\s*[:：])/).filter(Boolean);
}

function tableRowsAfterLabel(section, label, stopLabel) {
  const start = section.indexOf(label);
  if (start < 0) return [];
  const stop = stopLabel ? section.indexOf(stopLabel, start + label.length) : -1;
  const fragment = section.slice(start, stop < 0 ? undefined : stop);
  const tableStart = fragment.indexOf("<table");
  if (tableStart < 0) return [];
  const tableEnd = fragment.indexOf("</table>", tableStart);
  const table = fragment.slice(tableStart, tableEnd < 0 ? undefined : tableEnd + 8);
  return unique(
    [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1])))
      .filter((cells) => cells.length >= 2 && !/参数名/.test(cells[0]))
      .map((cells) => `${cells[0]}: ${cells.slice(1).join(" · ")}`),
  );
}

function moduleName(html, fallback) {
  const overrides = {
    cloudsever: "CloudSever",
    componentapi: "Component",
    globalfunc: "Global",
    obj: "Object",
  };
  if (overrides[fallback]) return overrides[fallback];
  const heading = html.match(/<h1[^>]*>[\s\S]*?<code>([A-Za-z][\w]*)<\/code>/i)?.[1];
  if (heading) return heading;
  const title = text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return title.match(/(?:接口|函数)\s+([A-Za-z][\w]*)/i)?.[1] ?? fallback;
}

function parseMethods(html, slug, url) {
  const markerIndex = html.indexOf("具体函数名及描述如下");
  if (markerIndex < 0 && !["cloudsever", "componentapi", "globalfunc", "obj"].includes(slug)) return null;
  const tableStart = html.indexOf("<table", Math.max(0, markerIndex));
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableStart < 0 || tableEnd < 0) return null;

  const table = html.slice(tableStart, tableEnd + 8);
  const module = moduleName(html, slug);
  const methods = [];

  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 3) continue;
    const anchor = cells[1].match(/href=["']#([^"']+)["']/i)?.[1] ?? "";
    const method = text(cells[1]).replace(/\s*\((?:\.\.\.)?\)\s*$/, "");
    if (!method || !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(method)) continue;
    const section = anchor ? sectionById(html, anchor) : "";
    const parameters = detailsAfterLabel(section, "参数及类型", "返回值及类型");
    const returns = detailsAfterLabel(section, "返回值及类型", "该方法");
    const parameterNames = parameters
      .map((line) => line.match(/^([A-Za-z_]\w*)\s*[:：]/)?.[1])
      .filter(Boolean);
    const receiver = slug === "componentapi" ? "self" : slug === "obj" ? "obj" : module;
    const call = slug === "globalfunc"
      ? `${method}(${parameterNames.join(", ")})`
      : `${receiver}:${method}(${parameterNames.join(", ")})`;

    methods.push({
      id: `${module}.${method}`,
      module,
      method,
      description: text(cells[2]),
      parameters,
      parameterNames,
      returns,
      receiver,
      call,
      docs: anchor ? `${url}#${anchor}` : url,
    });
  }

  return methods.length ? { module, slug, docs: url, methods } : null;
}

function parseEvents(html, url, prefix) {
  const events = new Map();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 3) continue;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const eventName = text(cells[1]).match(new RegExp(`${escapedPrefix}\\.([A-Za-z_]\\w*)`))?.[1];
    if (!eventName) continue;
    const anchor = cells[1].match(/href=["']#([^"']+)["']/i)?.[1] ?? "";
    const section = anchor ? sectionById(html, anchor) : "";
    const parameters = tableRowsAfterLabel(section, "事件传参", "具体使用");
    events.set(eventName, {
      id: `${prefix}.${eventName}`,
      family: prefix,
      event: eventName,
      description: text(cells[2]),
      parameters,
      docs: anchor ? `${url}#${anchor}` : url,
    });
  }
  return [...events.values()];
}

function parseComponentReference(html, url) {
  const headingPattern = /<(h[1-4])[^>]*id=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  const headings = [...html.matchAll(headingPattern)];
  const properties = [];
  const propertyIds = new Set();
  const internalProperties = [];
  const enums = [];
  const methods = [];

  function ownerFor(index) {
    const owner = headings.slice(0, index).reverse().find((entry) => entry[1].toLowerCase() === "h2");
    if (!owner) return { id: "Component", label: "组件" };
    const metadata = html.slice(owner.index + owner[0].length, headings[index].index);
    const componentId = metadata.match(/组件ID<\/strong>[\s\S]{0,100}?<code>([^<]+)<\/code>/i)?.[1];
    return { id: label(componentId || owner[3]), label: label(owner[3]) };
  }

  function rowsFrom(section) {
    const start = section.indexOf("<table");
    const end = section.indexOf("</table>", start);
    if (start < 0 || end < 0) return [];
    return [...section.slice(start, end + 8).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => label(cell[1])));
  }

  function tablesFrom(section) {
    return [...section.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((table) =>
      [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => label(cell[1]))),
    );
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = label(headings[index][3]);
    if (!/^(属性|枚举定义|方法\s*\/\s*接口)$/.test(heading)) continue;
    const component = ownerFor(index);
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const docs = `${url}#${headings[index][2]}`;

    if (heading === "属性") {
      const rows = rowsFrom(section);
      const headers = rows.shift() ?? [];
      const columns = Object.fromEntries(headers.map((header, column) => [header, column]));
      for (const cells of rows) {
        const field = cells[columns["字段"]] ?? "";
        const propertyLabel = cells[columns["属性名"]] ?? field;
        if (!field && !propertyLabel) continue;
        const id = `${component.id}.${field || `未公开字段-${properties.length + 1}`}`;
        if (propertyIds.has(id)) continue;
        propertyIds.add(id);
        properties.push({
          id,
          component: component.id,
          componentLabel: component.label,
          field,
          label: propertyLabel,
          type: cells[columns["类型"]] ?? "Any",
          default: cells[columns["默认值"]] ?? "",
          range: cells[columns["取值范围"]] ?? "",
          description: cells[columns["说明"]] ?? "",
          status: field ? "stable" : "incomplete",
          docs,
        });
      }
      for (const details of section.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/gi)) {
        if (!/内部字段/.test(label(details[1]))) continue;
        const internalRows = rowsFrom(details[1]);
        const internalHeaders = internalRows.shift() ?? [];
        const internalColumns = Object.fromEntries(internalHeaders.map((header, column) => [header, column]));
        for (const cells of internalRows) {
          const field = cells[internalColumns["字段"]] ?? "";
          if (!field) continue;
          internalProperties.push({
            id: `${component.id}.${field}`,
            component: component.id,
            componentLabel: component.label,
            field,
            label: field,
            type: cells[internalColumns["类型"]] ?? "Any",
            default: cells[internalColumns["默认值"]] ?? "",
            range: "",
            description: "官方标注为内部字段，一般无需配置。",
            status: "internal",
            docs,
          });
        }
      }
      continue;
    }

    if (heading === "枚举定义") {
      const enumType = label(section.match(/<p[^>]*>\s*<strong>\s*<code>([^<]+)<\/code>/i)?.[1] || "Enum");
      const rows = rowsFrom(section);
      const headers = rows.shift() ?? [];
      const columns = Object.fromEntries(headers.map((header, column) => [header, column]));
      for (const cells of rows) {
        const option = cells[columns["选项"]] ?? "";
        if (!option) continue;
        enums.push({
          id: `${component.id}.${enumType}.${option}`,
          component: component.id,
          componentLabel: component.label,
          enum: enumType,
          option,
          value: cells[columns["值"]] ?? "",
          description: cells[columns["含义"]] ?? "",
          docs,
        });
      }
      continue;
    }

    const items = [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => label(item[1]));
    let current = null;
    for (const item of items) {
      const signature = item.match(/^([A-Za-z_]\w*)\(([^)]*)\)\s*[—–-]\s*(.*)$/);
      if (signature) {
        const parameterTypes = signature[2].split(/\s*[,，]\s*/).map((entry) => entry.trim()).filter(Boolean);
        const parameterNames = parameterTypes.map((_, parameterIndex) => `arg${parameterIndex + 1}`);
        const detail = signature[3];
        const description = detail.split(/\s+(?=参数\d|返回\s)/)[0].trim();
        current = {
          id: `Component.${component.id}.${signature[1]}`,
          module: `组件 · ${component.id}`,
          component: component.id,
          componentLabel: component.label,
          method: signature[1],
          description,
          parameters: parameterTypes.map((type, parameterIndex) => `${parameterNames[parameterIndex]}: ${type}`),
          parameterNames,
          parameterTypes,
          returns: [],
          receiver: "component",
          call: `component:${signature[1]}(${parameterNames.join(", ")})`,
          docs,
        };
        methods.push(current);
      } else if (current && /^返回\s/.test(item)) {
        current.returns.push(item.replace(/^返回\s*/, "ret: "));
      }
    }
  }

  return { properties, internalProperties, enums, methods };
}

function parseGlobalEnums(html, url) {
  const headingPattern = /<(h[2-4])[^>]*id=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  const headings = [...html.matchAll(headingPattern)];
  const entries = [];
  const seen = new Set();
  for (let index = 0; index < headings.length; index += 1) {
    const headingName = label(headings[index][3]);
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    for (const table of section.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
      const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
        [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => label(cell[1])),
      );
      const headers = rows.shift() ?? [];
      if (headers.length < 2) continue;
      for (const cells of rows) {
        if (!cells[0]) continue;
        const qualified = cells[0].match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
        const enumName = qualified ? qualified[1] : headingName;
        const name = qualified ? qualified[2] : cells[0];
        if (enumName === "lua_type") continue;
        const id = `${enumName}.${name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push({
          id,
          enum: enumName,
          name,
          expression: qualified ? cells[0] : id,
          label: headingName,
          value: cells[1] ?? "",
          description: cells.slice(2).filter(Boolean).join(" · "),
          columns: Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""])),
          docs: `${url}#${headings[index][2]}`,
        });
      }
    }
  }
  return entries;
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

const indexHtml = await fetchText(INDEX_URL);
const pagePaths = unique(
  [...indexHtml.matchAll(/href=["'](\/ugc-wiki\/apis\/[^"'#?]+\.html)/gi)].map((match) => match[1]),
);
const pageUrls = unique([INDEX_URL, ...pagePaths.map((path) => new URL(path, ORIGIN).href), ...EXTRA_URLS]);

const pages = await mapLimit(pageUrls, 6, async (url) => ({ url, html: await fetchText(url) }));
const serviceModules = pages
  .map(({ html, url }) => {
    const slug = new URL(url).pathname.split("/").pop().replace(/\.html$/i, "");
    return parseMethods(html, slug, url);
  })
  .filter(Boolean)
  .sort((a, b) => a.module.localeCompare(b.module, "en"));

const componentPage = pages.find(({ url }) => url === COMPONENT_WIKI_URL);
const componentReference = componentPage
  ? parseComponentReference(componentPage.html, componentPage.url)
  : { properties: [], internalProperties: [], enums: [], methods: [] };
const globalEnumsPage = pages.find(({ url }) => url.endsWith("/apis/global.html"));
const globalEnums = globalEnumsPage ? parseGlobalEnums(globalEnumsPage.html, globalEnumsPage.url) : [];
const componentGroups = new Map();
for (const method of componentReference.methods) {
  if (!componentGroups.has(method.module)) componentGroups.set(method.module, []);
  componentGroups.get(method.module).push(method);
}
const componentModules = [...componentGroups.values()].map((group) => ({
  module: group[0].module,
  slug: "componentwiki",
  docs: group[0].docs.split("#")[0],
  methods: group,
}));
const modules = [...serviceModules, ...componentModules];
const serviceMethods = serviceModules.flatMap((module) => module.methods);
const methods = [...serviceMethods, ...componentReference.methods];
const triggerEventsPage = pages.find(({ url }) => url.endsWith("/triggerevent.html"));
const objectEventsPage = pages.find(({ url }) => url.endsWith("/componentevent.html"));
const triggerEvents = triggerEventsPage ? parseEvents(triggerEventsPage.html, triggerEventsPage.url, "TriggerEvent") : [];
const objectEvents = objectEventsPage ? parseEvents(objectEventsPage.html, objectEventsPage.url, "ObjectEvent") : [];
const events = [...triggerEvents, ...objectEvents];
const snapshot = {
  schemaVersion: 1,
  target: "Mini World UGC 3.0",
  source: INDEX_URL,
  generatedAt: new Date().toISOString(),
  stats: {
    pages: pages.length,
    modules: modules.length,
    serviceMethods: serviceMethods.length,
    componentMethods: componentReference.methods.length,
    methods: methods.length,
    triggerEvents: triggerEvents.length,
    objectEvents: objectEvents.length,
    events: events.length,
    componentProperties: componentReference.properties.length,
    internalComponentProperties: componentReference.internalProperties.length,
    documentedComponentProperties: componentReference.properties.length + componentReference.internalProperties.length,
    componentEnumValues: componentReference.enums.length,
    globalEnumFamilies: new Set(globalEnums.map((entry) => entry.enum)).size,
    globalEnumValues: globalEnums.length,
  },
  modules,
  methods,
  events,
  componentProperties: componentReference.properties,
  internalComponentProperties: componentReference.internalProperties,
  componentEnums: componentReference.enums,
  globalEnums,
};

const banner = `/* Generated by tools/sync-api.mjs from the public Mini World UGC 3.0 Wiki.\n * Do not edit this file by hand. The runtime catalog remains usable without it.\n */\n`;
await writeFile(OUT_FILE, `${banner}window.MINIWORLD_OFFICIAL_API = ${JSON.stringify(snapshot, null, 2)};\n`, "utf8");
console.log(`Wrote ${OUT_FILE}`);
console.log(JSON.stringify(snapshot.stats));
