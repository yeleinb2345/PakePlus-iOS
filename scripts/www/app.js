(function (global) {
  "use strict";

  var STORAGE_KEY = "miniworld-lua-flow.project.v2";
  var MAX_HISTORY = 100;
  var PROJECT_SCHEMA = 3;
  var project = null;
  var catalog = null;
  var nodeMap = new Map();
  var officialEventNames = new Set();
  var undoStack = [];
  var redoStack = [];
  var selectedUid = null;
  var activeKind = "all";
  var searchQuery = "";
  var pendingEditSnapshot = null;
  var elements = {};
  var initialized = false;
  var dragPayload = null;
  var resizeTimer = null;
  var activeActionZone = "actions";

  var LUA_RESERVED = new Set([
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
    "true", "until", "while"
  ]);

  var OFFICIAL_MODULE_LABELS = {
    Actor: "角色与生物",
    Area: "区域",
    Array: "数组",
    Backpack: "背包",
    Block: "方块",
    Buff: "状态效果",
    Chat: "聊天消息",
    CloudSever: "云端服务",
    Component: "组件",
    CustomUI: "自定义界面",
    Data: "数据",
    GameObject: "游戏对象",
    Global: "全局功能",
    Graphics: "画面表现",
    Item: "道具",
    Map: "地图",
    Mod: "模组",
    Monster: "生物",
    Object: "对象",
    Player: "玩家",
    Table: "数据表",
    Timeline: "剧情动画",
    Timer: "计时器",
    World: "世界",
    WorldContainer: "世界容器",
    CityGen: "城镇生成组件",
    Ride: "骑乘组件",
    BaseState: "基础状态组件",
    Oxygen: "氧气组件",
    Move: "移动组件",
    Transform: "变换组件",
    Model: "模型组件",
    Effect: "特效组件",
    Sound: "声音组件",
    Tag: "标签组件"
  };

  function byId() {
    for (var i = 0; i < arguments.length; i += 1) {
      var element = document.getElementById(arguments[i]);
      if (element) return element;
    }
    return null;
  }

  function uid(prefix) {
    var value = global.crypto && typeof global.crypto.randomUUID === "function"
      ? global.crypto.randomUUID().replace(/-/g, "")
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return (prefix || "id") + "_" + value;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function luaString(value) {
    var source = String(value == null ? "" : value);
    var result = '"';
    for (var i = 0; i < source.length; i += 1) {
      var code = source.charCodeAt(i);
      var character = source.charAt(i);
      if (character === "\\") result += "\\\\";
      else if (character === '"') result += '\\"';
      else if (character === "\n") result += "\\n";
      else if (character === "\r") result += "\\r";
      else if (character === "\t") result += "\\t";
      else if (code < 32 || code === 127) result += "\\" + String(code).padStart(3, "0");
      else result += character;
    }
    return result + '"';
  }

  function cleanIdentifier(value, fallback) {
    var result = String(value == null ? "" : value)
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!result) result = fallback || "value";
    if (/^[0-9]/.test(result)) result = "_" + result;
    if (LUA_RESERVED.has(result)) result = result + "_value";
    return result;
  }

  function cleanPath(value, fallback) {
    var parts = String(value == null ? "" : value).split(".").filter(Boolean);
    if (!parts.length) return cleanIdentifier(fallback || "API", "API");
    return parts.map(function (part) { return cleanIdentifier(part, "API"); }).join(".");
  }

  function cleanEventName(value) {
    var source = String(value == null ? "" : value).replace(/^TriggerEvent\./, "");
    return cleanIdentifier(source, "GameStart");
  }

  function expressionValue(value, fallback) {
    var result = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
    return result || fallback || "nil";
  }

  function commentText(value) {
    return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").replace(/--/g, "—").trim();
  }

  function isReadableText(value) {
    var text = String(value || "");
    if (!text) return false;
    var replacementCount = (text.match(/�/g) || []).length;
    return replacementCount < Math.max(2, text.length / 12);
  }

  function chineseTitle(value, fallback, maxLength) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    var chineseColon = text.indexOf("：");
    if (chineseColon > 0) {
      var suffix = text.slice(chineseColon + 1).trim();
      var prefix = text.slice(0, chineseColon);
      if (/[^\u3400-\u9fff]{4,}/.test(prefix) && /[\u3400-\u9fff]/.test(suffix)) text = suffix;
    }
    text = text.split(/[。；;\r\n]/)[0].trim();
    if (!/[\u3400-\u9fff]/.test(text)) text = fallback || "未命名接口";
    var limit = Number(maxLength) || 34;
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  }

  function officialModuleLabel(moduleName, methodEntry) {
    if (methodEntry && methodEntry.componentLabel) return chineseTitle(methodEntry.componentLabel, "组件");
    var raw = String(moduleName || "").replace(/^组件\s*·\s*/, "");
    return OFFICIAL_MODULE_LABELS[raw] || "官方功能";
  }

  function parameterUiLabel(parameter, index, parameterType) {
    var raw = String(parameter || "");
    var type = String(parameterType || (raw.indexOf(":") >= 0 ? raw.slice(raw.indexOf(":") + 1) : "")).trim();
    var readableType = /[\u3400-\u9fff]/.test(type) ? type.split(/[，,；;]/)[0].trim() : "";
    return "参数 " + (index + 1) + (readableType ? "（" + readableType + "）" : "");
  }

  function defaultParameterValue(name) {
    var key = String(name || "value").toLowerCase();
    if (/^(player|obj|actor|target|source|uin).*id$/.test(key) || /^(objid|playerid|eventobjid)$/.test(key)) return "event.eventobjid";
    if (/worldid/.test(key)) return "event.eventworldid or 0";
    if (/^(x|y|z)$/.test(key)) return "event." + key + " or 0";
    if (/^(b|is|has|can|enable|ignore|need|able)/.test(key)) return "false";
    if (/(name|content|text|title|desc|str|url)$/.test(key)) return '""';
    if (/(num|count|amount|speed|scale|damage|id|type|index|time|radius|angle|face|color)/.test(key)) return "0";
    if (/(pos|vec|rot|offset|list|infos|table)/.test(key)) return "{}";
    return "nil";
  }

  function normalizeParameterName(value, index) {
    var source = String(value || "").split(":")[0].trim();
    return cleanIdentifier(source, "arg" + (index + 1));
  }

  function parseOfficialCall(methodEntry, moduleEntry) {
    var call = String(methodEntry.call || "").trim();
    var callee = call.split("(")[0].trim();
    var receiver = String(methodEntry.receiver || moduleEntry.module || "").trim();
    var method = String(methodEntry.method || "Call").trim();
    var callStyle = ":";
    if (callee.indexOf(":") >= 0) {
      var colon = callee.lastIndexOf(":");
      receiver = callee.slice(0, colon).trim();
      method = callee.slice(colon + 1).trim();
      callStyle = ":";
    } else if (callee.indexOf(".") >= 0) {
      var dot = callee.lastIndexOf(".");
      receiver = callee.slice(0, dot).trim();
      method = callee.slice(dot + 1).trim();
      callStyle = ".";
    } else if (callee) {
      receiver = "";
      method = callee;
      callStyle = "";
    } else if (receiver === "Global") {
      receiver = "";
      callStyle = "";
    }
    return {
      receiver: receiver ? cleanPath(receiver, "API") : "",
      method: cleanIdentifier(method, "Call"),
      callStyle: callStyle,
      receiverMode: receiver === "obj" || receiver === "component" ? "expression" : "fixed",
      receiverDefault: receiver === "obj" ? "self" : receiver === "component" ? "self" : receiver
    };
  }

  function buildCatalog() {
    var base = global.MINIWORLD_API_CATALOG || {
      schemaVersion: 1,
      runtime: { name: "迷你世界 UGC 3.0", notice: "请按目标运行时校验接口。" },
      kinds: [{ id: "event", label: "事件" }, { id: "condition", label: "条件" }, { id: "action", label: "动作" }],
      nodes: []
    };
    var next = {
      schemaVersion: base.schemaVersion || 1,
      runtime: Object.assign({}, base.runtime || {}),
      kinds: Array.isArray(base.kinds) ? base.kinds.slice() : [],
      nodes: Array.isArray(base.nodes) ? base.nodes.slice() : []
    };
    officialEventNames = new Set();
    var reference = global.MINIWORLD_OFFICIAL_API;
    if (reference && Array.isArray(reference.events)) {
      reference.events.forEach(function (entry) {
        if (!entry || !entry.event) return;
        var eventName = cleanEventName(entry.event);
        var eventFamily = entry.family === "ObjectEvent" ? "ObjectEvent" : "TriggerEvent";
        officialEventNames.add(eventFamily + "." + eventName);
        var duplicate = next.nodes.some(function (node) {
          return node.kind === "event" && (node.eventFamily || "TriggerEvent") === eventFamily && cleanEventName(node.eventName) === eventName;
        });
        if (!duplicate) {
          next.nodes.push({
            id: "official.event." + eventFamily + "." + eventName,
            kind: "event",
            title: chineseTitle(entry.description, "官方事件"),
            category: "官方事件",
            compiler: "event",
            eventName: eventName,
            eventFamily: eventFamily,
            description: isReadableText(entry.description) ? entry.description : "UGC 3.0 官方事件 " + eventFamily + "." + eventName,
            parameters: Array.isArray(entry.parameters) ? entry.parameters : [],
            docs: entry.docs || "",
            keywords: [eventFamily, eventName, "官方事件"]
          });
        }
      });
    }
    if (reference && Array.isArray(reference.modules)) {
      reference.modules.forEach(function (moduleEntry) {
        if (!moduleEntry || !Array.isArray(moduleEntry.methods)) return;
        moduleEntry.methods.forEach(function (methodEntry) {
          if (!methodEntry || !methodEntry.method) return;
          var callInfo = parseOfficialCall(methodEntry, moduleEntry);
          var receiver = callInfo.receiver;
          var method = callInfo.method;
          var names = Array.isArray(methodEntry.parameterNames) && methodEntry.parameterNames.length
            ? methodEntry.parameterNames
            : (Array.isArray(methodEntry.parameters) ? methodEntry.parameters : []);
          var fields = names.map(function (parameter, index) {
            var key = normalizeParameterName(parameter, index);
            return {
              key: key,
              label: parameterUiLabel(parameter, index, methodEntry.parameterTypes && methodEntry.parameterTypes[index]),
              type: "expression",
              default: defaultParameterValue(key),
              required: false,
              placeholder: "输入脚本表达式"
            };
          });
          if (callInfo.receiverMode === "expression") {
            fields.unshift({ key: "__receiver", label: methodEntry.receiver === "component" ? "组件对象" : "游戏对象", type: "expression", default: callInfo.receiverDefault, required: true, placeholder: "例如 self" });
          }
          fields.push({ key: "__capture", label: "接收第一个返回值（可选）", type: "text", default: "", placeholder: "例如 result" });
          next.nodes.push({
            id: "official.method." + String(methodEntry.id || ((receiver || "Global") + "." + method)),
            kind: "action",
            title: chineseTitle(methodEntry.description, "调用官方接口"),
            category: "动作 · " + officialModuleLabel(moduleEntry.module || receiver || "Global", methodEntry),
            compiler: "officialApi",
            description: isReadableText(methodEntry.description) ? methodEntry.description : "UGC 3.0 官方接口 " + (methodEntry.call || method),
            api: {
              receiver: receiver,
              method: method,
              callStyle: callInfo.callStyle,
              receiverMode: callInfo.receiverMode,
              args: fields.filter(function (field) { return field.key !== "__capture" && field.key !== "__receiver"; }).map(function (field) { return field.key; })
            },
            fields: fields,
            signature: methodEntry.call || receiver + ":" + method + "(...)" ,
            returns: Array.isArray(methodEntry.returns) ? methodEntry.returns : [],
            docs: methodEntry.docs || moduleEntry.docs || "",
            keywords: [receiver, method, methodEntry.call || "", "官方接口"]
          });
        });
      });
    }
    if (reference && Array.isArray(reference.componentProperties)) {
      reference.componentProperties.forEach(function (property) {
        if (!property || property.status !== "stable" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(property.field || ""))) return;
        var type = String(property.type || "");
        var rawDefault = String(property.default == null ? "" : property.default).trim();
        var valueDefault = "nil";
        if (/布尔|boolean/i.test(type)) valueDefault = /^(true|false)$/.test(rawDefault) ? rawDefault : "false";
        else if (/数字|数值|整数|浮点|枚举|number|int|float|enum/i.test(type)) valueDefault = /^-?(?:\d+\.?\d*|\.\d+)$/.test(rawDefault) ? rawDefault : "0";
        else if (/字符|文本|string|text/i.test(type)) valueDefault = luaString(rawDefault);
        else if (/表|数组|列表|table|array|list/i.test(type)) valueDefault = "{}";
        next.nodes.push({
          id: "official.property." + String(property.id || (property.component + "." + property.field)),
          kind: "action",
          title: chineseTitle(property.label, "设置" + chineseTitle(property.componentLabel, "组件") + "属性"),
          category: "组件属性 · " + chineseTitle(property.componentLabel, "通用组件"),
          compiler: "officialProperty",
          description: property.description || property.label || ("设置组件属性 " + property.field),
          propertyLabel: property.label || "",
          property: { field: String(property.field), component: String(property.component || "") },
          fields: [
            { key: "component", label: "组件表达式", type: "expression", default: 'self:GetComponent("组件ID")', required: true, placeholder: "替换为实际组件 ID" },
            { key: "value", label: "属性值（" + (type || "未知类型") + "）", type: "expression", default: valueDefault, required: true }
          ],
          signature: "component." + property.field + " = value",
          docs: property.docs || "",
          keywords: [property.id || "", property.component || "", property.field, property.label || "", type, "组件属性"]
        });
      });
    }
    next.nodes.forEach(function (node) {
      var values = [node.id, node.title, node.category, node.description]
        .concat(node.keywords || [])
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      node.__searchText = values;
    });
    catalog = next;
    nodeMap = new Map(next.nodes.map(function (node) { return [node.id, node]; }));
    return next;
  }

  function makeInstance(nodeId) {
    var definition = nodeMap.get(nodeId);
    var values = {};
    (definition && definition.fields || []).forEach(function (field) {
      values[field.key] = field.default == null ? "" : field.default;
    });
    return { uid: uid("node"), nodeId: nodeId, values: values };
  }

  function makeTrigger(name, eventId) {
    return {
      id: uid("trigger"),
      name: name || "新触发器",
      enabled: true,
      event: makeInstance(eventId || "game.start"),
      conditions: [],
      actions: [],
      elseActions: []
    };
  }

  function makeProject() {
    var trigger = makeTrigger("玩家进入欢迎", "player.enter");
    var exists = makeInstance("condition.not_nil");
    exists.values.expression = "event.eventobjid";
    trigger.conditions.push(exists);
    var validPlayer = makeInstance("condition.compare");
    validPlayer.values.left = "event.eventobjid";
    validPlayer.values.operator = ">";
    validPlayer.values.right = "0";
    trigger.conditions.push(validPlayer);
    var welcome = makeInstance("action.chat_system");
    welcome.values.message = "欢迎来到迷你世界！";
    trigger.actions.push(welcome);
    var fallback = makeInstance("action.print");
    fallback.values.value = '"没有读取到有效玩家"';
    trigger.elseActions.push(fallback);
    return {
      schemaVersion: PROJECT_SCHEMA,
      id: uid("project"),
      name: "新的迷你世界项目",
      runtime: "ugc3-component",
      activeTriggerId: trigger.id,
      triggers: [trigger],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function makeExampleProject() {
    var welcome = makeTrigger("玩家进入欢迎", "player.enter");
    welcome.conditions.push(makeInstance("condition.not_nil"));
    welcome.actions.push(makeInstance("action.chat_system"));
    var counter = makeInstance("action.state_add");
    counter.values.name = "join_count";
    counter.values.amount = "1";
    welcome.actions.push(counter);
    var debug = makeInstance("action.print");
    debug.values.value = '"玩家进入，累计：" .. tostring(MW_STATE["join_count"])';
    welcome.actions.push(debug);

    var click = makeTrigger("点击方块反馈", "block.click");
    var exists = makeInstance("condition.not_nil");
    exists.values.expression = "event.eventobjid";
    click.conditions.push(exists);
    var message = makeInstance("action.chat_system");
    message.values.message = "你点击了一个方块";
    click.actions.push(message);
    var fallback = makeInstance("action.print");
    fallback.values.value = '"点击事件没有提供有效玩家对象"';
    click.elseActions.push(fallback);

    return {
      schemaVersion: PROJECT_SCHEMA,
      id: uid("project"),
      name: "UGC 3.0 示例项目",
      runtime: "ugc3-component",
      activeTriggerId: welcome.id,
      triggers: [welcome, click],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function sanitizeInstance(input, expectedKind) {
    if (!input || typeof input !== "object") return null;
    var nodeId = String(input.nodeId || input.typeId || "");
    if (!nodeId && input.id && nodeMap.has(String(input.id))) nodeId = String(input.id);
    if (!nodeId) return null;
    var definition = nodeMap.get(nodeId);
    if (definition && expectedKind && definition.kind !== expectedKind) return null;
    var instance = {
      uid: String(input.uid || uid("node")),
      nodeId: nodeId,
      values: input.values && typeof input.values === "object" && !Array.isArray(input.values) ? Object.assign({}, input.values) : {}
    };
    (definition && definition.fields || []).forEach(function (field) {
      if (instance.values[field.key] == null) instance.values[field.key] = field.default == null ? "" : field.default;
    });
    return instance;
  }

  function sanitizeProject(input) {
    if (!input || typeof input !== "object" || !Array.isArray(input.triggers)) throw new Error("项目 JSON 缺少 triggers 数组");
    var triggers = input.triggers.map(function (source, index) {
      if (!source || typeof source !== "object") return null;
      var event = sanitizeInstance(source.event, "event");
      var trigger = {
        id: String(source.id || uid("trigger")),
        name: String(source.name || "触发器 " + (index + 1)).slice(0, 120),
        enabled: source.enabled !== false,
        event: event,
        conditions: (Array.isArray(source.conditions) ? source.conditions : []).map(function (item) { return sanitizeInstance(item, "condition"); }).filter(Boolean),
        actions: (Array.isArray(source.actions) ? source.actions : []).map(function (item) { return sanitizeInstance(item, "action"); }).filter(Boolean),
        elseActions: (Array.isArray(source.elseActions) ? source.elseActions : Array.isArray(source.otherwiseActions) ? source.otherwiseActions : Array.isArray(source.else) ? source.else : []).map(function (item) { return sanitizeInstance(item, "action"); }).filter(Boolean)
      };
      return trigger;
    }).filter(Boolean);
    if (!triggers.length) triggers.push(makeTrigger("游戏开始", "game.start"));
    var activeId = String(input.activeTriggerId || "");
    if (!triggers.some(function (trigger) { return trigger.id === activeId; })) activeId = triggers[0].id;
    return {
      schemaVersion: PROJECT_SCHEMA,
      id: String(input.id || uid("project")),
      name: String(input.name || "导入的项目").slice(0, 160),
      runtime: "ugc3-component",
      activeTriggerId: activeId,
      triggers: triggers,
      createdAt: String(input.createdAt || new Date().toISOString()),
      updatedAt: new Date().toISOString()
    };
  }

  function currentTrigger() {
    if (!project || !project.triggers.length) return null;
    var trigger = project.triggers.find(function (item) { return item.id === project.activeTriggerId; });
    if (!trigger) {
      trigger = project.triggers[0];
      project.activeTriggerId = trigger.id;
    }
    return trigger;
  }

  function allInstances(trigger) {
    if (!trigger) return [];
    return (trigger.event ? [trigger.event] : []).concat(trigger.conditions || [], trigger.actions || [], trigger.elseActions || []);
  }

  function findInstance(instanceUid) {
    for (var i = 0; i < project.triggers.length; i += 1) {
      var trigger = project.triggers[i];
      if (trigger.event && trigger.event.uid === instanceUid) return { trigger: trigger, instance: trigger.event, kind: "event", zone: "event", index: 0 };
      var conditionIndex = trigger.conditions.findIndex(function (node) { return node.uid === instanceUid; });
      if (conditionIndex >= 0) return { trigger: trigger, instance: trigger.conditions[conditionIndex], kind: "condition", zone: "conditions", index: conditionIndex };
      var actionIndex = trigger.actions.findIndex(function (node) { return node.uid === instanceUid; });
      if (actionIndex >= 0) return { trigger: trigger, instance: trigger.actions[actionIndex], kind: "action", zone: "actions", index: actionIndex };
      var elseActionIndex = (trigger.elseActions || []).findIndex(function (node) { return node.uid === instanceUid; });
      if (elseActionIndex >= 0) return { trigger: trigger, instance: trigger.elseActions[elseActionIndex], kind: "action", zone: "elseActions", index: elseActionIndex };
    }
    return null;
  }

  function projectSnapshot() {
    return JSON.stringify(project);
  }

  function pushUndo(snapshot) {
    if (!snapshot) return;
    if (undoStack[undoStack.length - 1] !== snapshot) undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function commitMutation(mutator, options) {
    var before = projectSnapshot();
    mutator();
    var after = projectSnapshot();
    if (before !== after) {
      pushUndo(before);
      project.updatedAt = new Date().toISOString();
      persistProject();
    }
    if (!options || options.render !== false) renderAll();
    else updateGeneratedOutput();
  }

  function commitPendingEdit() {
    if (!pendingEditSnapshot) return;
    var before = pendingEditSnapshot;
    pendingEditSnapshot = null;
    if (before !== projectSnapshot()) {
      pushUndo(before);
      project.updatedAt = new Date().toISOString();
      persistProject();
      updateHistoryButtons();
    }
  }

  function undo() {
    commitPendingEdit();
    if (!undoStack.length) return;
    redoStack.push(projectSnapshot());
    project = sanitizeProject(JSON.parse(undoStack.pop()));
    selectedUid = null;
    persistProject();
    renderAll();
    toast("已撤销");
  }

  function redo() {
    commitPendingEdit();
    if (!redoStack.length) return;
    undoStack.push(projectSnapshot());
    project = sanitizeProject(JSON.parse(redoStack.pop()));
    selectedUid = null;
    persistProject();
    renderAll();
    toast("已重做");
  }

  function persistProject() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      if (elements.saveStatus) {
        elements.saveStatus.textContent = "已自动保存";
        elements.saveStatus.dataset.state = "saved";
      }
    } catch (error) {
      if (elements.saveStatus) {
        elements.saveStatus.textContent = "本地保存失败";
        elements.saveStatus.dataset.state = "error";
      }
    }
  }

  function loadStoredProject() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitizeProject(JSON.parse(raw));
    } catch (error) {
      toast("本地项目损坏，已创建新项目", "warning");
    }
    return makeProject();
  }

  function fieldLuaValue(field, value) {
    if (field && field.valueType === "expression") return expressionValue(value, expressionValue(field.default, "nil"));
    if (!field) return expressionValue(value, "nil");
    if (field.type === "number") {
      var numeric = Number(value);
      return Number.isFinite(numeric) ? String(numeric) : String(Number(field.default) || 0);
    }
    if (field.type === "checkbox") return value === true || value === "true" ? "true" : "false";
    if (field.type === "expression") return expressionValue(value, expressionValue(field.default, "nil"));
    if (field.type === "select") return luaString(value == null ? field.default : value);
    return luaString(value == null ? "" : value);
  }

  function compileCondition(instance, definition) {
    var values = instance.values || {};
    switch (definition.compiler) {
      case "compare":
        return "(" + expressionValue(values.left, "nil") + ") " + validOperator(values.operator) + " (" + expressionValue(values.right, "nil") + ")";
      case "rawCondition":
        return "(" + expressionValue(values.expression, "false") + ")";
      case "eventFieldCompare":
        return "event." + cleanIdentifier(values.field, "value") + " " + validOperator(values.operator) + " (" + expressionValue(values.right, "nil") + ")";
      case "stateCompare":
        return "MW_STATE[" + luaString(values.name) + "] " + validOperator(values.operator) + " (" + expressionValue(values.right, "nil") + ")";
      case "notNil":
        return "(" + expressionValue(values.expression, "nil") + ") ~= nil";
      case "range":
        return "((" + expressionValue(values.value, "0") + ") >= (" + expressionValue(values.min, "0") + ") and (" + expressionValue(values.value, "0") + ") <= (" + expressionValue(values.max, "0") + "))";
      case "chance":
        var percent = Math.max(0, Math.min(100, Number(values.percent) || 0));
        return "math.random(1, 100) <= " + percent;
      case "stringContains":
        return "string.find(tostring(" + expressionValue(values.haystack, '""') + "), " + luaString(values.needle) + ", 1, true) ~= nil";
      default:
        return "true --[[ 未识别条件：" + commentText(definition.title) + " ]]";
    }
  }

  function validOperator(value) {
    return ["==", "~=", ">", ">=", "<", "<="].indexOf(value) >= 0 ? value : "==";
  }

  function compileApiCall(instance, definition) {
    var api = definition.api || {};
    var receiver = cleanPath(api.receiver, "API");
    var method = cleanIdentifier(api.method, "Call");
    var args = (api.args || []).map(function (key) {
      var field = (definition.fields || []).find(function (candidate) { return candidate.key === key; });
      return fieldLuaValue(field, instance.values ? instance.values[key] : undefined);
    });
    var capture = definition.compiler === "officialApi" ? instance.values.__capture : "";
    var prefix = capture ? "local " + cleanIdentifier(capture, "result") + " = " : "";
    var callee;
    if (api.receiverMode === "expression") {
      var receiverExpression = expressionValue(instance.values.__receiver, "self");
      callee = (receiverExpression === "self" ? "self" : "(" + receiverExpression + ")") + (api.callStyle || ":") + method;
    } else if (api.callStyle === "") {
      callee = method;
    } else {
      callee = receiver + (api.callStyle === "." ? "." : ":") + method;
    }
    return [prefix + callee + "(" + args.join(", ") + ")"];
  }

  function compileAction(instance, definition) {
    var values = instance.values || {};
    switch (definition.compiler) {
      case "api":
      case "officialApi":
        return compileApiCall(instance, definition);
      case "officialProperty":
        return ["(" + expressionValue(values.component, 'self:GetComponent("组件ID")') + ")." + cleanIdentifier(definition.property && definition.property.field, "value") + " = " + expressionValue(values.value, "nil")];
      case "stateSet":
        return ["MW_STATE[" + luaString(values.name) + "] = " + expressionValue(values.value, "nil")];
      case "stateAdd":
        return ["MW_STATE[" + luaString(values.name) + "] = (MW_STATE[" + luaString(values.name) + "] or 0) + (" + expressionValue(values.amount, "0") + ")"];
      case "localSet":
        return ["local " + cleanIdentifier(values.name, "value") + " = " + expressionValue(values.value, "nil")];
      case "print":
        return ["print(" + expressionValue(values.value, '""') + ")"];
      case "comment":
        return ["-- " + commentText(values.text)];
      case "nativeApi":
        var receiver = cleanPath(values.receiver, "API");
        var method = cleanIdentifier(values.method, "Call");
        var style = values.callStyle === "." ? "." : ":";
        var capture = String(values.capture || "").trim();
        var rawArgs = String(values.args == null ? "" : values.args).replace(/\u0000/g, "").trim();
        return [(capture ? "local " + cleanIdentifier(capture, "result") + " = " : "") + receiver + style + method + "(" + rawArgs + ")"];
      case "nativeLua":
        return String(values.code || "-- 原生 Lua 节点为空").replace(/\r\n?/g, "\n").split("\n");
      default:
        return ["-- 未识别动作：" + commentText(definition.title)];
    }
  }

  function handlerName(trigger, used) {
    var ascii = String(trigger.name || "Trigger").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!ascii && trigger.event) ascii = eventInfo(trigger.event, nodeMap.get(trigger.event.nodeId)).name;
    var base = "On" + cleanIdentifier(ascii, "Trigger");
    var candidate = base;
    var index = 2;
    while (used.has(candidate)) {
      candidate = base + "_" + index;
      index += 1;
    }
    used.add(candidate);
    return candidate;
  }

  function eventInfo(instance, definition) {
    var custom = definition && definition.compiler === "customEvent";
    var family = custom && instance && instance.values && instance.values.eventFamily === "ObjectEvent"
      ? "ObjectEvent"
      : (definition && definition.eventFamily === "ObjectEvent" ? "ObjectEvent" : "TriggerEvent");
    var name = custom ? instance.values.eventName : definition && definition.eventName;
    return { family: family, name: cleanEventName(name) };
  }

  function appendCompiledActions(lines, instances, indent, emptyComment) {
    var nodes = Array.isArray(instances) ? instances : [];
    if (!nodes.length && emptyComment) lines.push(indent + "-- " + emptyComment);
    nodes.forEach(function (instance) {
      var definition = nodeMap.get(instance.nodeId);
      var actionLines = definition ? compileAction(instance, definition) : ["-- 未知动作节点：" + commentText(instance.nodeId)];
      actionLines.forEach(function (line) { lines.push(indent + line); });
    });
  }

  function generateLua(targetProject) {
    var source = targetProject || project;
    var enabled = source.triggers.filter(function (trigger) { return trigger.enabled && trigger.event; });
    var usedHandlers = new Set();
    var compiled = enabled.map(function (trigger) {
      var eventDefinition = nodeMap.get(trigger.event.nodeId);
      var info = eventInfo(trigger.event, eventDefinition);
      return { trigger: trigger, eventName: info.name, eventFamily: info.family, handler: handlerName(trigger, usedHandlers), eventDefinition: eventDefinition };
    });
    var lines = [
      "-- MiniWorld UGC 3.0 component script",
      "-- 由图形化触发器编辑器生成；导入目标组件前请核对资源 ID 与运行时 API 版本。",
      "",
      "local Script = {}",
      "local MW_STATE = {}",
      "",
      "function Script:OnStart()"
    ];
    if (!compiled.length) lines.push("    -- 当前没有启用且配置完整的触发器");
    compiled.forEach(function (item) {
      if (item.eventFamily === "ObjectEvent") lines.push("    self:AddEvent(ObjectEvent." + item.eventName + ", self." + item.handler + ")");
      else lines.push("    self:AddTriggerEvent(TriggerEvent." + item.eventName + ", self." + item.handler + ")");
    });
    lines.push("end", "");

    compiled.forEach(function (item, itemIndex) {
      var trigger = item.trigger;
      lines.push("-- " + commentText(trigger.name));
      lines.push("function Script:" + item.handler + "(event)");
      lines.push("    event = event or {}");
      var conditionExpressions = trigger.conditions.map(function (instance) {
        var definition = nodeMap.get(instance.nodeId);
        return definition ? compileCondition(instance, definition) : "true --[[ 未知条件节点 ]]";
      });
      var elseActions = Array.isArray(trigger.elseActions) ? trigger.elseActions : [];
      if (conditionExpressions.length || elseActions.length) {
        lines.push("    if ");
        if (conditionExpressions.length) {
          lines[lines.length - 1] += "(";
          conditionExpressions.forEach(function (condition, index) {
            lines.push("        " + (index ? "and " : "") + "(" + condition + ")");
          });
          lines.push("    ) then");
        } else {
          lines[lines.length - 1] += "true then -- 没有条件，因此始终进入“那么”分支";
        }
        appendCompiledActions(lines, trigger.actions, "        ", "“那么”分支暂无动作");
        if (elseActions.length) {
          lines.push("    else");
          appendCompiledActions(lines, elseActions, "        ", "“否则”分支暂无动作");
        }
        lines.push("    end");
      } else {
        appendCompiledActions(lines, trigger.actions, "    ", "此触发器暂无动作");
      }
      lines.push("end");
      if (itemIndex < compiled.length - 1) lines.push("");
    });
    lines.push("", "return Script", "");
    return lines.join("\n");
  }

  function diagnose(targetProject) {
    var source = targetProject || project;
    var problems = [];
    if (!source.triggers.length) problems.push({ severity: "error", code: "NO_TRIGGERS", message: "项目中没有触发器。" });
    var names = new Map();
    var enabledEventFamilies = new Set();
    source.triggers.forEach(function (trigger) {
      var prefix = "“" + trigger.name + "”";
      if (!trigger.enabled) problems.push({ severity: "info", code: "DISABLED", triggerId: trigger.id, message: prefix + " 已停用，不会输出注册代码。" });
      if (!trigger.event) problems.push({ severity: "error", code: "NO_EVENT", triggerId: trigger.id, message: prefix + " 缺少事件节点。" });
      allInstances(trigger).forEach(function (instance) {
        var definition = nodeMap.get(instance.nodeId);
        if (!definition) {
          problems.push({ severity: "error", code: "UNKNOWN_NODE", triggerId: trigger.id, nodeUid: instance.uid, message: prefix + " 包含当前目录无法识别的节点 " + instance.nodeId + "。" });
          return;
        }
        (definition.fields || []).forEach(function (field) {
          var value = instance.values ? instance.values[field.key] : null;
          if (field.required && String(value == null ? "" : value).trim() === "") {
            problems.push({ severity: "error", code: "REQUIRED_FIELD", triggerId: trigger.id, nodeUid: instance.uid, message: prefix + " 的“" + definition.title + "”缺少“" + field.label + "”。" });
          }
          if (field.type === "expression" && /[\r\n]/.test(String(value || ""))) {
            problems.push({ severity: "warning", code: "MULTILINE_EXPRESSION", triggerId: trigger.id, nodeUid: instance.uid, message: prefix + " 的“" + field.label + "”包含换行，请确认是合法 Lua 表达式。" });
          }
        });
        if (definition.compiler === "nativeApi" || definition.compiler === "nativeLua") {
          problems.push({ severity: "warning", code: "NATIVE_NODE", triggerId: trigger.id, nodeUid: instance.uid, message: prefix + " 使用“" + definition.title + "”，编辑器只能检查结构，不能验证运行时语义。" });
        }
        if (definition.compiler === "officialProperty" && /组件ID/.test(String(instance.values.component || ""))) {
          problems.push({ severity: "warning", code: "COMPONENT_ID", triggerId: trigger.id, nodeUid: instance.uid, message: prefix + " 的组件属性“" + definition.title + "”仍使用占位组件 ID。" });
        }
        if (definition.compiler === "officialApi" && (definition.fields || []).some(function (field) {
          return field.key !== "__capture" && expressionValue(instance.values[field.key], "nil") === "nil";
        })) {
          problems.push({ severity: "warning", code: "NIL_ARGUMENT", triggerId: trigger.id, nodeUid: instance.uid, message: prefix + " 的官方接口“" + definition.title + "”仍有 nil 参数，请按签名填写。" });
        }
      });
      if (trigger.event) {
        var eventDefinition = nodeMap.get(trigger.event.nodeId);
        var info = eventInfo(trigger.event, eventDefinition);
        if (trigger.enabled) enabledEventFamilies.add(info.family);
        if (officialEventNames.size && eventDefinition && eventDefinition.compiler !== "customEvent" && !officialEventNames.has(info.family + "." + info.name)) {
          problems.push({ severity: "warning", code: "UNVERIFIED_EVENT", triggerId: trigger.id, nodeUid: trigger.event.uid, message: prefix + " 的 " + info.family + "." + info.name + " 未在当前官方快照中找到。" });
        }
      }
      var key = String(trigger.name || "").toLocaleLowerCase("zh-CN");
      if (names.has(key)) problems.push({ severity: "info", code: "DUPLICATE_NAME", triggerId: trigger.id, message: "存在同名触发器“" + trigger.name + "”；生成器会自动保证处理函数名唯一。" });
      names.set(key, true);
      var elseActions = Array.isArray(trigger.elseActions) ? trigger.elseActions : [];
      if (trigger.enabled && trigger.actions.length === 0 && elseActions.length === 0) problems.push({ severity: "info", code: "NO_ACTIONS", triggerId: trigger.id, message: prefix + " 的“那么”和“否则”分支都没有动作。" });
      if (elseActions.length && trigger.conditions.length === 0) problems.push({ severity: "warning", code: "ELSE_WITHOUT_CONDITION", triggerId: trigger.id, message: prefix + " 有“否则”动作但没有条件；生成代码中的“否则”分支不会执行。" });
      if (trigger.conditions.length && trigger.actions.length === 0 && elseActions.length) problems.push({ severity: "info", code: "EMPTY_TRUE_BRANCH", triggerId: trigger.id, message: prefix + " 的“那么”分支为空，仅“否则”分支有动作。" });
    });
    if (enabledEventFamilies.size > 1) {
      problems.unshift({ severity: "error", code: "MIXED_EVENT_FAMILY", message: "同一组件脚本不能混用 TriggerEvent 与 ObjectEvent：世界/UI 组件使用 AddTriggerEvent，对象组件使用 AddEvent。请拆分为两个项目导出。" });
    }
    return problems;
  }

  function collectElements() {
    var canvas = byId("canvas-content", "canvas", "workflow-canvas");
    elements = {
      app: byId("app"),
      projectName: byId("project-name"),
      triggerList: byId("trigger-list"),
      addTrigger: byId("add-trigger-btn"),
      deleteTrigger: byId("delete-trigger-btn"),
      duplicateTrigger: byId("duplicate-trigger-btn"),
      searches: [byId("node-search"), byId("block-search")].filter(Boolean),
      catalogTabs: byId("catalog-tabs"),
      nodeCatalog: byId("node-catalog", "block-library"),
      canvas: canvas,
      connections: byId("connections-layer"),
      emptyCanvas: byId("empty-canvas"),
      inspector: byId("inspector"),
      inspectorContent: byId("inspector-content"),
      luaOutput: byId("lua-output"),
      copyLua: byId("copy-lua-btn"),
      downloadLua: byId("download-lua-btn", "export-lua"),
      exportJson: byId("export-json-btn"),
      importJson: byId("import-json-btn", "open-project"),
      importInput: byId("import-json-input"),
      undo: byId("undo-btn"),
      redo: byId("redo-btn"),
      loadExample: byId("load-example-btn"),
      clearProject: byId("clear-project-btn"),
      diagnostics: byId("diagnostic-list", "diagnostics"),
      problemList: byId("problem-list"),
      diagnosticCount: byId("diagnostic-count"),
      saveStatus: byId("save-status"),
      runtimeBanner: byId("runtime-banner"),
      newProject: byId("new-project"),
      saveProject: byId("save-project"),
      validateProject: byId("validate-project", "validate-project-btn"),
      runPreview: byId("run-preview"),
      toastRegion: byId("toast-region"),
      modalRoot: byId("modal-root"),
      toggleLibrary: byId("toggle-library-btn"),
      toggleInspector: byId("toggle-inspector-btn"),
      activeTriggerName: byId("active-trigger-name"),
      statusTriggerCount: byId("status-trigger-count"),
      statusNodeCount: byId("status-node-count")
    };
  }

  function kindLabel(kind) {
    var item = (catalog.kinds || []).find(function (candidate) { return candidate.id === kind; });
    return item ? item.label : kind;
  }

  function renderCatalogTabs() {
    if (!elements.catalogTabs) return;
    var kinds = [{ id: "all", label: "全部" }].concat(catalog.kinds || []);
    elements.catalogTabs.innerHTML = kinds.map(function (kind) {
      return '<button type="button" role="tab" class="catalog-tab ' + escapeHtml(kind.id) + (activeKind === kind.id ? " is-active active" : "") + '" data-catalog-kind="' + escapeHtml(kind.id) + '" aria-selected="' + (activeKind === kind.id) + '">' + escapeHtml(kind.label) + "</button>";
    }).join("");
  }

  function renderCatalog() {
    renderCatalogTabs();
    if (!elements.nodeCatalog) return;
    var query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    var filtered = catalog.nodes.filter(function (node) {
      return (query || activeKind === "all" || node.kind === activeKind) && (!query || node.__searchText.indexOf(query) >= 0);
    });
    var limit = query ? 240 : 180;
    var visible = filtered.slice(0, limit);
    var catalogCount = byId("catalog-count");
    if (catalogCount) catalogCount.textContent = filtered.length + " 个";
    var groups = new Map();
    visible.forEach(function (node) {
      var key = node.category || kindLabel(node.kind);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    });
    var html = "";
    groups.forEach(function (nodes, group) {
      var groupKind = nodes[0] && nodes[0].kind || "action";
      var iconKind = /^官方|^组件/.test(group) ? "api" : groupKind;
      html += '<section class="catalog-group"><div class="catalog-group-heading"><span class="category-badge ' + escapeHtml(iconKind) + '"><svg><use href="#icon-' + escapeHtml(iconKind === "api" ? "api" : groupKind) + '"></use></svg></span><span>' + escapeHtml(group) + '</span><span class="group-total">' + nodes.length + "</span><span></span></div>";
      html += '<div class="catalog-items">';
      nodes.forEach(function (node) {
        var nodeClass = node.compiler === "officialApi" || node.compiler === "officialProperty" || node.compiler === "nativeApi" ? "api" : node.kind;
        html += '<button type="button" class="catalog-node node-card block-card ' + escapeHtml(nodeClass) + ' kind-' + escapeHtml(node.kind) + '" data-node-id="' + escapeHtml(node.id) + '" data-node-type="' + escapeHtml(node.id) + '" data-category="' + escapeHtml(node.kind) + '" draggable="true" aria-label="添加' + escapeHtml(node.title) + '">';
        html += '<span class="node-glyph"><svg><use href="#icon-' + escapeHtml(nodeClass === "api" ? "api" : node.kind) + '"></use></svg></span><span><strong>' + escapeHtml(node.title) + "</strong>";
        html += '<small>' + escapeHtml(node.signature || node.description || kindLabel(node.kind)) + '</small></span><span class="drag-handle" aria-hidden="true">⠿</span></button>';
      });
      html += "</div></section>";
    });
    if (!visible.length) html = '<div class="catalog-empty">没有匹配的节点</div>';
    if (filtered.length > visible.length) html += '<p class="catalog-limit">当前显示前 ' + visible.length + " 个，共 " + filtered.length + " 个；输入模块或方法名可继续筛选。</p>";
    elements.nodeCatalog.innerHTML = html;
  }

  function renderTriggerList() {
    if (!elements.triggerList) return;
    elements.triggerList.innerHTML = project.triggers.map(function (trigger, index) {
      var active = trigger.id === project.activeTriggerId;
      return '<button type="button" class="trigger-item' + (active ? " is-active active" : "") + (trigger.enabled ? "" : " is-disabled") + '" data-trigger-id="' + escapeHtml(trigger.id) + '">' +
        '<span class="trigger-item-icon"><svg><use href="#icon-trigger"></use></svg></span><span class="trigger-copy trigger-item-copy"><strong>' + escapeHtml(trigger.name) + '</strong><small>' + trigger.conditions.length + " 条件 · " + (trigger.actions.length + (trigger.elseActions || []).length) + " 动作</small></span>" +
        '<span class="trigger-status trigger-state" title="' + (trigger.enabled ? "已启用" : "已停用") + '"></span></button>';
    }).join("");
  }

  function nodeSummary(instance, definition) {
    if (!definition) return instance.nodeId;
    if (definition.kind === "event") {
      var info = eventInfo(instance, definition);
      return info.family + "." + info.name;
    }
    var fields = (definition.fields || []).filter(function (field) { return field.key !== "__capture"; }).slice(0, 2);
    var parts = fields.map(function (field) {
      var value = instance.values ? instance.values[field.key] : "";
      return String(value == null ? "" : value);
    }).filter(Boolean);
    return parts.join(" · ") || definition.description || kindLabel(definition.kind);
  }

  function isNarrowCanvas() {
    return typeof global.matchMedia === "function" && global.matchMedia("(max-width: 760px)").matches;
  }

  function primaryNodeLabel(definition) {
    if (!definition) return "未知积木";
    if (definition.compiler === "officialApi") return definition.title || "调用官方接口";
    if (definition.compiler === "officialProperty") return definition.title || "设置组件属性";
    if (definition.kind === "event" && definition.eventName) return definition.title || "发生官方事件";
    return definition.title || "未命名积木";
  }

  function technicalNodeLabel(instance, definition) {
    if (!definition) return instance.nodeId;
    if (definition.kind === "event") return nodeSummary(instance, definition);
    return definition.signature || (definition.api && (definition.api.receiver ? definition.api.receiver + (definition.api.callStyle || ":") : "") + definition.api.method + "(…)") || definition.id;
  }

  function renderWorkflowNode(instance, kind, index, total, zone) {
    var definition = nodeMap.get(instance.nodeId);
    var selected = instance.uid === selectedUid;
    var title = primaryNodeLabel(definition);
    var technical = technicalNodeLabel(instance, definition);
    var fields = (definition && definition.fields || []).filter(function (field) { return field.key !== "__capture" && field.key !== "__receiver"; }).slice(0, 2);
    var preview = fields.map(function (field) {
      var value = instance.values && instance.values[field.key];
      return '<span class="block-field-chip"><span>' + escapeHtml(field.label) + '</span><code>' + escapeHtml(String(value == null ? "" : value)) + "</code></span>";
    }).join("");
    var controls = "";
    if (kind !== "event") {
      controls += '<button type="button" data-move-node="up" title="向上移动" aria-label="向上移动"' + (index === 0 ? " disabled" : "") + '>上移</button>';
      controls += '<button type="button" data-move-node="down" title="向下移动" aria-label="向下移动"' + (index === total - 1 ? " disabled" : "") + ">下移</button>";
    }
    controls += '<button type="button" data-remove-node title="删除积木" aria-label="删除积木">删除</button>';
    var blockClass = kind === "event" ? "event-cap" : kind === "condition" ? "condition-block" : "action-block";
    return '<article class="block-node ' + blockClass + (zone === "elseActions" ? " is-else-action" : "") + (selected ? " is-selected selected" : "") + '" data-instance-uid="' + escapeHtml(instance.uid) + '" data-node-id="' + escapeHtml(instance.uid) + '" data-node-kind="' + escapeHtml(kind) + '" data-node-type="' + escapeHtml(instance.nodeId) + '" data-zone="' + escapeHtml(zone || kind) + '" draggable="' + (kind !== "event") + '" tabindex="0">' +
      '<span class="block-grip" aria-hidden="true">⠿</span><span class="block-kind-badge">' + escapeHtml(kindLabel(kind)) + '</span><div class="block-node-copy"><strong class="block-node-title">' + escapeHtml(title) + '</strong><small class="block-node-tech">' + escapeHtml(technical) + "</small></div>" +
      (preview ? '<div class="block-field-preview">' + preview + "</div>" : "") + '<div class="block-node-controls">' + controls + "</div></article>";
  }

  function updateCanvasConnections(trigger) {
    if (!elements.connections) return;
    elements.connections.style.display = "none";
    elements.connections.innerHTML = "";
  }

  function renderDropPlaceholder(zone, text) {
    return '<button type="button" class="branch-placeholder" data-select-zone="' + escapeHtml(zone) + '"><span>＋</span><strong>' + escapeHtml(text) + '</strong><small>从左侧节点库拖入，或先点这里再点击节点</small></button>';
  }

  function renderActionZone(trigger, zone, title, description, extraClass) {
    var list = zone === "elseActions" ? trigger.elseActions : trigger.actions;
    var active = activeActionZone === zone;
    var nodes = list.map(function (node, index) { return renderWorkflowNode(node, "action", index, list.length, zone); }).join("");
    return '<section class="program-branch ' + escapeHtml(extraClass || "") + (active ? " is-active-zone" : "") + '"><header class="branch-label"><span>' + escapeHtml(title) + '</span><small>' + escapeHtml(description) + '</small><button type="button" data-select-zone="' + escapeHtml(zone) + '">' + (active ? "当前添加位置" : "设为添加位置") + '</button></header><div class="branch-dropzone action-dropzone" data-zone="' + escapeHtml(zone) + '" data-drop-kind="action">' +
      (nodes || renderDropPlaceholder(zone, zone === "elseActions" ? "添加否则动作" : "添加那么动作")) + "</div></section>";
  }

  function renderCanvas() {
    if (!elements.canvas) return;
    var trigger = currentTrigger();
    if (!trigger) {
      elements.canvas.innerHTML = '<div class="canvas-empty">请先创建触发器</div>';
      return;
    }
    var conditions = trigger.conditions.map(function (node, index) { return renderWorkflowNode(node, "condition", index, trigger.conditions.length, "conditions"); }).join("");
    var eventBlock = trigger.event ? renderWorkflowNode(trigger.event, "event", 0, 1, "event") : renderDropPlaceholder("event", "添加触发事件");
    var html = '<div class="block-program" data-trigger-stack data-trigger-id="' + escapeHtml(trigger.id) + '" data-active-action-zone="' + escapeHtml(activeActionZone) + '"><div class="program-flow-line" aria-hidden="true"></div>' +
      '<section class="program-event"><header class="program-section-label"><span>当</span><small>事件发生时开始执行</small></header><div class="branch-dropzone event-dropzone" data-zone="event" data-drop-kind="event">' + eventBlock + "</div></section>" +
      '<section class="if-frame"><header class="if-frame-header"><span class="if-keyword">如果</span><div><strong>以下条件全部满足</strong><small>多个条件按“并且”组合；没有条件时视为满足</small></div></header>' +
      '<div class="branch-dropzone condition-dropzone" data-zone="conditions" data-drop-kind="condition">' + (conditions || renderDropPlaceholder("conditions", "添加判断条件")) + "</div>" +
      renderActionZone(trigger, "actions", "那么", "条件满足时依次执行", "then-branch") +
      renderActionZone(trigger, "elseActions", "否则", "条件不满足时依次执行", "else-branch") +
      '<footer class="if-frame-end"><span>结束判断</span></footer></section><div class="program-end-cap"><span>结束触发器</span></div></div>';
    elements.canvas.innerHTML = html;
    elements.canvas.style.overflowY = "auto";
    elements.canvas.style.overflowX = "hidden";
    if (elements.emptyCanvas) elements.emptyCanvas.hidden = true;
    if (elements.inspectorContent) elements.inspectorContent.dataset.selection = selectedUid || "";
    updateCanvasConnections(trigger);
  }

  function renderField(field, value) {
    var id = "field_" + cleanIdentifier(field.key, "value");
    var common = ' id="' + escapeHtml(id) + '" data-field="' + escapeHtml(field.key) + '"' + (field.required ? " required" : "") + (field.placeholder ? ' placeholder="' + escapeHtml(field.placeholder) + '"' : "");
    var control = "";
    if (field.type === "textarea" || (field.type === "expression" && field.multiline)) {
      control = '<textarea' + common + ' rows="' + Number(field.rows || (field.type === "textarea" ? 7 : 3)) + '">' + escapeHtml(value) + "</textarea>";
    } else if (field.type === "select") {
      control = '<select' + common + '>' + (field.options || []).map(function (option) {
        var item = typeof option === "object" ? option : { label: option, value: option };
        return '<option value="' + escapeHtml(item.value) + '"' + (String(item.value) === String(value) ? " selected" : "") + '>' + escapeHtml(item.label) + "</option>";
      }).join("") + "</select>";
    } else if (field.type === "checkbox") {
      control = '<input type="checkbox"' + common + (value === true || value === "true" ? " checked" : "") + ">";
    } else {
      control = '<input type="' + (field.type === "number" ? "number" : "text") + '"' + common + ' value="' + escapeHtml(value) + '"' + (field.min != null ? ' min="' + Number(field.min) + '"' : "") + (field.max != null ? ' max="' + Number(field.max) + '"' : "") + ">";
    }
    return '<label class="field inspector-field field-row" for="' + escapeHtml(id) + '"><span>' + escapeHtml(field.label) + (field.required ? " *" : "") + "</span>" + control + (field.help ? '<small>' + escapeHtml(field.help) + "</small>" : "") + "</label>";
  }

  function renderInspector() {
    if (!elements.inspectorContent) return;
    var located = selectedUid ? findInstance(selectedUid) : null;
    var trigger = currentTrigger();
    elements.inspectorContent.dataset.selection = located ? located.instance.uid : "";
    if (!located) {
      if (!trigger) {
        elements.inspectorContent.innerHTML = '<div class="inspector-empty">请选择一个触发器或节点</div>';
        return;
      }
      elements.inspectorContent.innerHTML = '<div class="inspector-heading"><span>触发器</span><h3>' + escapeHtml(trigger.name) + '</h3><p>管理名称与启用状态</p></div><div class="property-section is-open"><div class="property-fields">' +
        '<label class="field inspector-field field-row"><span>名称</span><input type="text" data-trigger-field="name" value="' + escapeHtml(trigger.name) + '" maxlength="120"></label>' +
        '<label class="inspector-check"><input type="checkbox" data-trigger-field="enabled"' + (trigger.enabled ? " checked" : "") + '> 启用此触发器</label>' +
        '<p class="inspector-note">选择画布中的节点可编辑详细属性。</p></div></div>';
      return;
    }
    var definition = nodeMap.get(located.instance.nodeId);
    if (!definition) {
      elements.inspectorContent.innerHTML = '<div class="inspector-error"><h3>未知节点</h3><p>' + escapeHtml(located.instance.nodeId) + '</p><button type="button" data-delete-selected>删除此节点</button></div>';
      return;
    }
    var html = '<div class="inspector-heading kind-' + escapeHtml(definition.kind) + '"><span>' + escapeHtml(kindLabel(definition.kind)) + '</span><h3>' + escapeHtml(definition.title) + '</h3><p>' + escapeHtml(definition.description || "") + "</p></div>";
    html += '<div class="property-section is-open"><div class="property-fields">';
    if (definition.signature) html += '<code class="api-signature">' + escapeHtml(definition.signature) + "</code>";
    html += '<div class="inspector-fields">';
    (definition.fields || []).forEach(function (field) {
      var value = located.instance.values[field.key];
      html += renderField(field, value == null ? field.default : value);
    });
    html += "</div></div></div>";
    if (definition.parameters && definition.parameters.length) html += '<details class="event-parameters"><summary>事件数据字段</summary><ul>' + definition.parameters.map(function (item) { return '<li>' + escapeHtml(item) + "</li>"; }).join("") + "</ul></details>";
    if (definition.returns && definition.returns.length) html += '<details class="api-returns"><summary>返回值</summary><ul>' + definition.returns.map(function (item) { return '<li>' + escapeHtml(item) + "</li>"; }).join("") + "</ul></details>";
    if (definition.docs) html += '<a class="api-doc-link" href="' + escapeHtml(definition.docs) + '" target="_blank" rel="noopener noreferrer">查看官方文档 ↗</a>';
    html += '<button type="button" class="danger inspector-delete" data-delete-selected>删除节点</button>';
    elements.inspectorContent.innerHTML = html;
  }

  function renderDiagnostics(problems) {
    var legacyEmpty = document.querySelector("#diagnostics > .diagnostics-empty");
    if (legacyEmpty) legacyEmpty.hidden = true;
    var targets = [elements.diagnostics, elements.problemList].filter(function (target, index, array) { return target && array.indexOf(target) === index; });
    var errors = problems.filter(function (problem) { return problem.severity === "error"; }).length;
    var warnings = problems.filter(function (problem) { return problem.severity === "warning"; }).length;
    if (elements.diagnosticCount) {
      elements.diagnosticCount.textContent = problems.length ? String(problems.length) : "0";
      elements.diagnosticCount.dataset.severity = errors ? "error" : warnings ? "warning" : "ok";
    }
    targets.forEach(function (target) {
      if (!problems.length) {
        target.innerHTML = '<div class="diagnostic-empty ok"><strong>未发现结构问题</strong><span>仍需在目标地图中验证资源 ID 与运行时行为。</span></div>';
        return;
      }
      target.innerHTML = problems.map(function (problem) {
        var icon = problem.severity === "error" ? "×" : problem.severity === "warning" ? "!" : "i";
        return '<button type="button" class="diagnostic-item severity-' + escapeHtml(problem.severity) + '"' + (problem.triggerId ? ' data-problem-trigger="' + escapeHtml(problem.triggerId) + '"' : "") + (problem.nodeUid ? ' data-problem-node="' + escapeHtml(problem.nodeUid) + '"' : "") + '><span>' + icon + '</span><span><strong>' + escapeHtml(problem.code) + '</strong><small>' + escapeHtml(problem.message) + "</small></span></button>";
      }).join("");
    });
  }

  function updateGeneratedOutput() {
    var lua = generateLua();
    if (elements.luaOutput) {
      if ("value" in elements.luaOutput) elements.luaOutput.value = lua;
      else elements.luaOutput.textContent = lua;
    }
    renderDiagnostics(diagnose());
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (elements.undo) elements.undo.disabled = undoStack.length === 0;
    if (elements.redo) elements.redo.disabled = redoStack.length === 0;
  }

  function renderAll() {
    if (!project) return;
    if (elements.projectName) {
      if ("value" in elements.projectName) elements.projectName.value = project.name;
      else elements.projectName.textContent = project.name;
    }
    renderTriggerList();
    renderCatalog();
    renderCanvas();
    renderInspector();
    updateGeneratedOutput();
    var trigger = currentTrigger();
    if (elements.activeTriggerName) elements.activeTriggerName.textContent = trigger ? trigger.name : "无触发器";
    if (elements.statusTriggerCount) elements.statusTriggerCount.textContent = project.triggers.length + " 个触发器";
    if (elements.statusNodeCount) elements.statusNodeCount.textContent = project.triggers.reduce(function (count, item) { return count + allInstances(item).length; }, 0) + " 个节点";
    if (elements.runtimeBanner) {
      var reference = global.MINIWORLD_OFFICIAL_API;
      var stats = reference && reference.stats;
      var messageNode = elements.runtimeBanner.querySelector(".runtime-message");
      var metaNode = elements.runtimeBanner.querySelector(".runtime-meta");
      var message = catalog.runtime.notice || "中国版迷你世界 3.0 组件脚本";
      var meta = stats ? "快照：" + stats.events + " 事件 · " + stats.methods + " 方法 · " + (stats.componentProperties || 0) + " 属性 · " + (stats.globalEnumValues || 0) + " 枚举值" : "运行目标：中国版 · 3.0";
      if (messageNode) messageNode.textContent = message;
      else elements.runtimeBanner.textContent = message + " " + meta;
      if (metaNode) metaNode.textContent = meta;
    }
  }

  function addNode(nodeId) {
    var definition = nodeMap.get(nodeId);
    var trigger = currentTrigger();
    if (!definition || !trigger) return false;
    var requestedZone = arguments.length > 1 ? arguments[1] : null;
    commitMutation(function () {
      var instance = makeInstance(nodeId);
      if (definition.kind === "event") {
        trigger.event = instance;
      } else if (definition.kind === "condition") {
        trigger.conditions.push(instance);
      } else if (definition.kind === "action") {
        var actionZone = requestedZone === "elseActions" ? "elseActions" : requestedZone === "actions" ? "actions" : activeActionZone;
        if (actionZone !== "elseActions") actionZone = "actions";
        trigger[actionZone].push(instance);
        activeActionZone = actionZone;
      }
      selectedUid = instance.uid;
    });
    toast("已添加“" + definition.title + "”");
    if (elements.app && isNarrowCanvas()) elements.app.dataset.libraryOpen = "false";
    return true;
  }

  function removeNode(instanceUid) {
    var located = findInstance(instanceUid);
    if (!located) return;
    commitMutation(function () {
      if (located.kind === "event") located.trigger.event = null;
      else if (located.kind === "condition") located.trigger.conditions.splice(located.index, 1);
      else located.trigger[located.zone === "elseActions" ? "elseActions" : "actions"].splice(located.index, 1);
      if (selectedUid === instanceUid) selectedUid = null;
    });
  }

  function zoneList(trigger, zone) {
    if (zone === "conditions") return trigger.conditions;
    if (zone === "elseActions") return trigger.elseActions;
    if (zone === "actions") return trigger.actions;
    return null;
  }

  function zoneAcceptsKind(zone, kind) {
    return (zone === "conditions" && kind === "condition") || ((zone === "actions" || zone === "elseActions") && kind === "action");
  }

  function moveNode(instanceUid, directionOrTarget, requestedZone) {
    var located = findInstance(instanceUid);
    if (!located || located.kind === "event") return;
    var list = zoneList(located.trigger, located.zone);
    var targetIndex;
    if (directionOrTarget === "up") targetIndex = located.index - 1;
    else if (directionOrTarget === "down") targetIndex = located.index + 1;
    else {
      var target = directionOrTarget ? findInstance(directionOrTarget) : null;
      var targetZone = target ? target.zone : requestedZone;
      if (!targetZone || !zoneAcceptsKind(targetZone, located.kind)) return;
      if (target && (target.trigger.id !== located.trigger.id || target.kind !== located.kind)) return;
      var targetList = zoneList(located.trigger, targetZone);
      targetIndex = target ? target.index : targetList.length;
      commitMutation(function () {
        var item = list.splice(located.index, 1)[0];
        if (targetList === list && located.index < targetIndex) targetIndex -= 1;
        targetIndex = Math.max(0, Math.min(targetList.length, targetIndex));
        targetList.splice(targetIndex, 0, item);
        if (targetZone === "actions" || targetZone === "elseActions") activeActionZone = targetZone;
      });
      return;
    }
    targetIndex = Math.max(0, Math.min(list.length - 1, targetIndex));
    if (targetIndex === located.index) return;
    commitMutation(function () {
      var item = list.splice(located.index, 1)[0];
      list.splice(targetIndex, 0, item);
    });
  }

  function addTrigger() {
    commitMutation(function () {
      var trigger = makeTrigger("触发器 " + (project.triggers.length + 1), "game.start");
      project.triggers.push(trigger);
      project.activeTriggerId = trigger.id;
      selectedUid = null;
    });
  }

  function duplicateTrigger() {
    var source = currentTrigger();
    if (!source) return;
    commitMutation(function () {
      var copy = deepClone(source);
      copy.id = uid("trigger");
      copy.name = source.name + " 副本";
      allInstances(copy).forEach(function (instance) { instance.uid = uid("node"); });
      var index = project.triggers.indexOf(source);
      project.triggers.splice(index + 1, 0, copy);
      project.activeTriggerId = copy.id;
      selectedUid = null;
    });
  }

  function deleteTrigger() {
    var trigger = currentTrigger();
    if (!trigger) return;
    commitMutation(function () {
      var index = project.triggers.indexOf(trigger);
      project.triggers.splice(index, 1);
      if (!project.triggers.length) project.triggers.push(makeTrigger("游戏开始", "game.start"));
      project.activeTriggerId = project.triggers[Math.min(index, project.triggers.length - 1)].id;
      selectedUid = null;
    });
  }

  function replaceProject(next, message) {
    var before = project ? projectSnapshot() : null;
    project = sanitizeProject(next);
    if (before) pushUndo(before);
    selectedUid = null;
    persistProject();
    renderAll();
    if (message) toast(message);
  }

  function downloadBlob(content, filename, type) {
    var blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function safeFilename(extension) {
    var base = String(project.name || "miniworld-script").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
    return (base || "miniworld-script") + extension;
  }

  function canProduceRunnableOutput() {
    var problems = diagnose();
    var errors = problems.filter(function (problem) { return problem.severity === "error"; });
    if (!errors.length) return true;
    renderDiagnostics(problems);
    activateBottomTab("diagnostics");
    toast("发现 " + errors.length + " 个必须修复的问题，暂未导出脚本", "error");
    return false;
  }

  function exportLua() {
    if (!canProduceRunnableOutput()) return;
    downloadBlob(generateLua(), safeFilename(".lua"), "text/x-lua;charset=utf-8");
    toast("Lua 脚本已导出");
  }

  function exportJson() {
    downloadBlob(JSON.stringify(project, null, 2) + "\n", safeFilename(".mwtrigger.json"), "application/json;charset=utf-8");
    toast("项目 JSON 已导出");
  }

  function copyLua() {
    if (!canProduceRunnableOutput()) return;
    var lua = generateLua();
    var promise;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      promise = navigator.clipboard.writeText(lua);
    } else {
      var area = document.createElement("textarea");
      area.value = lua;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var copied = document.execCommand("copy");
      area.remove();
      promise = copied ? Promise.resolve() : Promise.reject(new Error("copy failed"));
    }
    promise.then(function () { toast("Lua 已复制到剪贴板"); }).catch(function () { toast("复制失败，请手动复制输出区", "error"); });
  }

  function importJsonFile(file) {
    if (!file) return;
    file.text().then(function (text) {
      replaceProject(JSON.parse(text), "项目导入成功");
    }).catch(function (error) {
      toast("导入失败：" + error.message, "error");
    }).finally(function () {
      if (elements.importInput) elements.importInput.value = "";
    });
  }

  function toast(message, severity) {
    var region = elements.toastRegion;
    if (!region) {
      if (elements.saveStatus) elements.saveStatus.textContent = message;
      return;
    }
    var item = document.createElement("div");
    item.className = "toast toast-" + (severity || "success");
    item.setAttribute("role", "status");
    item.textContent = message;
    region.appendChild(item);
    global.setTimeout(function () {
      item.classList.add("is-leaving");
      global.setTimeout(function () { item.remove(); }, 250);
    }, 2600);
  }

  function showPreviewNotice() {
    var message = "浏览器无法模拟迷你世界运行时。当前输出已完成结构诊断；请将 .lua 放入目标 UGC 3.0 世界/UI 组件进行联调。";
    if (elements.modalRoot) {
      elements.modalRoot.innerHTML = '<div class="modal-backdrop" data-close-modal><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="preview-title"><button type="button" data-close-modal aria-label="关闭">×</button><h2 id="preview-title">运行预览说明</h2><p>' + escapeHtml(message) + '</p><button type="button" data-close-modal>知道了</button></section></div>';
    } else toast(message, "warning");
  }

  function bindButton(element, handler) {
    if (element) element.addEventListener("click", handler);
  }

  function bindEvents() {
    bindButton(elements.addTrigger, addTrigger);
    bindButton(elements.deleteTrigger, deleteTrigger);
    bindButton(elements.duplicateTrigger, duplicateTrigger);
    bindButton(elements.undo, undo);
    bindButton(elements.redo, redo);
    bindButton(elements.copyLua, copyLua);
    bindButton(elements.downloadLua, exportLua);
    bindButton(elements.exportJson, exportJson);
    bindButton(elements.importJson, function () { if (elements.importInput) elements.importInput.click(); });
    bindButton(elements.loadExample, function () { replaceProject(makeExampleProject(), "示例项目已载入"); });
    bindButton(elements.clearProject, function () { replaceProject(makeProject(), "已清空为新项目"); });
    bindButton(elements.newProject, function () { replaceProject(makeProject(), "已新建项目"); });
    bindButton(elements.saveProject, function () { persistProject(); toast("项目已保存到本机"); });
    bindButton(elements.validateProject, function () {
      var problems = diagnose();
      var errors = problems.filter(function (problem) { return problem.severity === "error"; }).length;
      toast(errors ? "诊断完成：发现 " + errors + " 个错误" : "诊断完成：没有结构错误", errors ? "error" : "success");
      renderDiagnostics(problems);
    });
    bindButton(elements.runPreview, showPreviewNotice);
    bindButton(elements.toggleLibrary, function () {
      if (!elements.app) return;
      var open = elements.app.dataset.libraryOpen !== "true";
      elements.app.dataset.libraryOpen = String(open);
      if (open) elements.app.dataset.inspectorOpen = "false";
    });
    bindButton(elements.toggleInspector, function () {
      if (!elements.app) return;
      var open = elements.app.dataset.inspectorOpen !== "true";
      elements.app.dataset.inspectorOpen = String(open);
      if (open) elements.app.dataset.libraryOpen = "false";
    });

    if (elements.importInput) elements.importInput.addEventListener("change", function (event) { importJsonFile(event.target.files && event.target.files[0]); });
    elements.searches.forEach(function (input) {
      input.addEventListener("input", function (event) {
        searchQuery = event.target.value || "";
        elements.searches.forEach(function (other) { if (other !== event.target) other.value = searchQuery; });
        renderCatalog();
      });
    });

    if (elements.catalogTabs) elements.catalogTabs.addEventListener("click", function (event) {
      var button = event.target.closest("[data-catalog-kind], [data-kind], [data-category]");
      if (!button) return;
      var value = button.dataset.catalogKind || button.dataset.kind || button.dataset.category;
      if (["all", "event", "condition", "action"].indexOf(value) < 0) return;
      activeKind = value;
      renderCatalog();
    });

    if (elements.nodeCatalog) {
      elements.nodeCatalog.addEventListener("click", function (event) {
        var target = event.target.closest("[data-add-node], [data-node-id]");
        if (target) addNode(target.dataset.addNode || target.dataset.nodeId, activeActionZone);
      });
      elements.nodeCatalog.addEventListener("keydown", function (event) {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-node-id]")) {
          event.preventDefault();
          addNode(event.target.dataset.nodeId, activeActionZone);
        }
      });
      elements.nodeCatalog.addEventListener("dragstart", function (event) {
        var card = event.target.closest("[data-node-id]");
        if (!card) return;
        dragPayload = { type: "catalog", nodeId: card.dataset.nodeId };
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-miniworld-node", card.dataset.nodeId);
        event.dataTransfer.setData("text/plain", card.dataset.nodeId);
      });
    }

    if (elements.triggerList) elements.triggerList.addEventListener("click", function (event) {
      var target = event.target.closest("[data-trigger-id]");
      if (!target) return;
      project.activeTriggerId = target.dataset.triggerId;
      selectedUid = null;
      persistProject();
      renderAll();
    });

    if (elements.canvas) {
      elements.canvas.addEventListener("click", function (event) {
        if (elements.app) {
          elements.app.dataset.libraryOpen = "false";
          elements.app.dataset.inspectorOpen = "false";
        }
        var zoneSelector = event.target.closest("[data-select-zone]");
        if (zoneSelector) {
          event.stopPropagation();
          var selectedZone = zoneSelector.dataset.selectZone;
          if (selectedZone === "actions" || selectedZone === "elseActions") {
            activeActionZone = selectedZone;
            activeKind = "action";
          } else if (selectedZone === "conditions") {
            activeKind = "condition";
          } else if (selectedZone === "event") {
            activeKind = "event";
          }
          selectedUid = null;
          renderCatalog();
          renderCanvas();
          renderInspector();
          if (elements.app && isNarrowCanvas()) elements.app.dataset.libraryOpen = "true";
          if (elements.searches[0]) elements.searches[0].focus({ preventScroll: true });
          return;
        }
        var node = event.target.closest("[data-instance-uid]");
        if (event.target.closest("[data-remove-node]") && node) {
          event.stopPropagation();
          removeNode(node.dataset.instanceUid);
          return;
        }
        var mover = event.target.closest("[data-move-node]");
        if (mover && node) {
          event.stopPropagation();
          moveNode(node.dataset.instanceUid, mover.dataset.moveNode);
          return;
        }
        if (node) {
          selectedUid = node.dataset.instanceUid;
          renderCanvas();
          renderInspector();
          return;
        }
        if (event.target.matches("[data-trigger-enabled]")) return;
        selectedUid = null;
        renderCanvas();
        renderInspector();
      });
      elements.canvas.addEventListener("change", function (event) {
        if (!event.target.matches("[data-trigger-enabled]")) return;
        var trigger = currentTrigger();
        commitMutation(function () { trigger.enabled = event.target.checked; });
      });
      elements.canvas.addEventListener("dragstart", function (event) {
        var node = event.target.closest("[data-instance-uid]");
        if (!node) return;
        dragPayload = { type: "instance", uid: node.dataset.instanceUid };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-miniworld-instance", node.dataset.instanceUid);
      });
      elements.canvas.addEventListener("dragover", function (event) {
        if (!event.target.closest("[data-drop-kind], [data-instance-uid]")) return;
        event.preventDefault();
        var zone = event.target.closest("[data-drop-kind]");
        elements.canvas.querySelectorAll(".branch-dropzone.is-drag-over").forEach(function (item) { if (item !== zone) item.classList.remove("is-drag-over"); });
        if (zone) zone.classList.add("is-drag-over");
        event.dataTransfer.dropEffect = dragPayload && dragPayload.type === "catalog" ? "copy" : "move";
      });
      elements.canvas.addEventListener("dragleave", function (event) {
        var zone = event.target.closest("[data-drop-kind]");
        if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-drag-over");
      });
      elements.canvas.addEventListener("drop", function (event) {
        var dropzone = event.target.closest("[data-drop-kind]");
        if (!dropzone) return;
        event.preventDefault();
        var requestedZone = dropzone.dataset.zone;
        dropzone.classList.remove("is-drag-over");
        if (dragPayload && dragPayload.type === "catalog") {
          var definition = nodeMap.get(dragPayload.nodeId);
          if (definition && definition.kind === dropzone.dataset.dropKind) addNode(dragPayload.nodeId, requestedZone);
          else toast("请拖到对应的事件、条件或动作区域", "warning");
        } else if (dragPayload && dragPayload.type === "instance") {
          var target = event.target.closest("[data-instance-uid]");
          var located = findInstance(dragPayload.uid);
          if (located && zoneAcceptsKind(requestedZone, located.kind)) {
            moveNode(dragPayload.uid, target && target.dataset.instanceUid !== dragPayload.uid ? target.dataset.instanceUid : null, requestedZone);
          } else toast("这个积木不能放入该分支", "warning");
        }
        dragPayload = null;
      });
      elements.canvas.addEventListener("dragend", function () {
        dragPayload = null;
        elements.canvas.querySelectorAll(".branch-dropzone.is-drag-over").forEach(function (item) { item.classList.remove("is-drag-over"); });
      });
    }

    if (elements.inspectorContent) {
      elements.inspectorContent.addEventListener("focusin", function (event) {
        if (event.target.matches("[data-field], [data-trigger-field]") && !pendingEditSnapshot) pendingEditSnapshot = projectSnapshot();
      });
      elements.inspectorContent.addEventListener("input", handleInspectorInput);
      elements.inspectorContent.addEventListener("change", function (event) {
        handleInspectorInput(event);
        commitPendingEdit();
        renderCanvas();
        updateGeneratedOutput();
      });
      elements.inspectorContent.addEventListener("focusout", function () { commitPendingEdit(); });
      elements.inspectorContent.addEventListener("click", function (event) {
        if (event.target.closest("[data-delete-selected]") && selectedUid) removeNode(selectedUid);
      });
    }

    if (elements.projectName) {
      elements.projectName.addEventListener("focus", function () { if (!pendingEditSnapshot) pendingEditSnapshot = projectSnapshot(); });
      elements.projectName.addEventListener("input", function (event) {
        project.name = "value" in event.target ? event.target.value : event.target.textContent;
        project.updatedAt = new Date().toISOString();
        persistProject();
      });
      elements.projectName.addEventListener("change", function () { commitPendingEdit(); renderAll(); });
      elements.projectName.addEventListener("blur", function () { commitPendingEdit(); renderTriggerList(); });
    }

    var diagnosticTargets = [elements.diagnostics, elements.problemList].filter(Boolean);
    diagnosticTargets.forEach(function (target) {
      target.addEventListener("click", function (event) {
        var item = event.target.closest("[data-problem-trigger]");
        if (!item) return;
        project.activeTriggerId = item.dataset.problemTrigger;
        selectedUid = item.dataset.problemNode || null;
        renderAll();
      });
    });

    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-close-modal]") && elements.modalRoot) elements.modalRoot.innerHTML = "";
      var actionTarget = event.target.closest("[data-action]");
      if (actionTarget && actionTarget.dataset.action === "dismiss-banner" && elements.runtimeBanner) {
        elements.runtimeBanner.hidden = true;
        if (elements.app) elements.app.style.setProperty("--banner-height", "0px");
      }
      if (actionTarget && actionTarget.dataset.action === "toggle-bottom-panel" && elements.app) {
        var expanded = elements.app.dataset.bottomExpanded !== "true";
        elements.app.dataset.bottomExpanded = String(expanded);
        elements.app.style.setProperty("--bottom-height", expanded ? "min(62vh, 520px)" : "var(--bottom-height-default, 236px)");
      }
      var bottomTab = event.target.closest("[data-bottom-tab]");
      if (bottomTab) activateBottomTab(bottomTab.dataset.bottomTab);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && elements.app) {
        elements.app.dataset.libraryOpen = "false";
        elements.app.dataset.inspectorOpen = "false";
        if (elements.modalRoot) elements.modalRoot.innerHTML = "";
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      var key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      else if (key === "y" || (key === "z" && event.shiftKey)) { event.preventDefault(); redo(); }
      else if (key === "s") { event.preventDefault(); persistProject(); toast("项目已保存到本机"); }
    });
    global.addEventListener("resize", function () {
      global.clearTimeout(resizeTimer);
      resizeTimer = global.setTimeout(function () {
        renderCanvas();
      }, 120);
    });
  }

  function handleInspectorInput(event) {
    var fieldKey = event.target.dataset.field;
    var triggerKey = event.target.dataset.triggerField;
    var value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (fieldKey && selectedUid) {
      var located = findInstance(selectedUid);
      if (located) located.instance.values[fieldKey] = value;
    } else if (triggerKey) {
      var trigger = currentTrigger();
      if (triggerKey === "enabled") trigger.enabled = Boolean(value);
      else if (triggerKey === "name") trigger.name = String(value).slice(0, 120);
    } else return;
    project.updatedAt = new Date().toISOString();
    persistProject();
    updateGeneratedOutput();
  }

  function activateBottomTab(value) {
    document.querySelectorAll("[data-bottom-tab]").forEach(function (tab) {
      var active = tab.dataset.bottomTab === value;
      tab.classList.toggle("is-active", active);
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-bottom-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.bottomPanel !== value;
    });
  }

  function refreshCatalog() {
    buildCatalog();
    if (project) project = sanitizeProject(project);
    renderAll();
    return { nodes: catalog.nodes.length, officialEvents: officialEventNames.size };
  }

  function getCatalogStats() {
    var reference = global.MINIWORLD_OFFICIAL_API;
    var stats = reference && reference.stats || {};
    return {
      catalogNodes: catalog ? catalog.nodes.length : 0,
      events: officialEventNames.size,
      methods: catalog ? catalog.nodes.filter(function (node) { return node.compiler === "officialApi"; }).length : 0,
      componentProperties: catalog ? catalog.nodes.filter(function (node) { return node.compiler === "officialProperty"; }).length : 0,
      globalEnumFamilies: Number(stats.globalEnumFamilies || 0),
      globalEnumValues: Number(stats.globalEnumValues || 0)
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;
    buildCatalog();
    collectElements();
    project = loadStoredProject();
    bindEvents();
    renderAll();
    persistProject();
    global.MiniWorldTriggerEditor = {
      version: "1.0.0",
      getProject: function () { return deepClone(project); },
      setProject: function (value) { replaceProject(value, "项目已载入"); return deepClone(project); },
      newProject: function () { replaceProject(makeProject()); return deepClone(project); },
      loadExample: function () { replaceProject(makeExampleProject()); return deepClone(project); },
      generateLua: function (value) { return generateLua(value ? sanitizeProject(value) : project); },
      diagnose: function (value) { return diagnose(value ? sanitizeProject(value) : project); },
      addNode: addNode,
      refreshCatalog: refreshCatalog,
      getCatalogStats: getCatalogStats,
      exportJson: function () { return JSON.stringify(project, null, 2); },
      helpers: { luaString: luaString, cleanIdentifier: cleanIdentifier }
    };
    if (elements.app) elements.app.dataset.ready = "true";
    global.dispatchEvent(new CustomEvent("miniworld-editor-ready", { detail: global.MiniWorldTriggerEditor }));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
