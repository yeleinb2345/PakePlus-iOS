(function (global) {
  "use strict";

  var text = function (key, label, value, extra) {
    return Object.assign({ key: key, label: label, type: "text", default: value == null ? "" : value }, extra || {});
  };
  var expression = function (key, label, value, extra) {
    return Object.assign({ key: key, label: label, type: "expression", default: value == null ? "" : value }, extra || {});
  };
  var number = function (key, label, value, extra) {
    return Object.assign({ key: key, label: label, type: "number", default: value == null ? 0 : value }, extra || {});
  };
  var select = function (key, label, value, options, extra) {
    return Object.assign({ key: key, label: label, type: "select", default: value, options: options }, extra || {});
  };

  var events = [
    ["game.start", "游戏开始", "GameStart", "游戏与世界"],
    ["game.hour", "游戏时间变化", "GameHour", "游戏与世界"],
    ["game.timer", "计时器变化", "MinitimerChange", "游戏与世界"],
    ["player.enter", "任意玩家进入", "GameAnyPlayerEnterGame", "玩家"],
    ["player.leave", "任意玩家离开", "GameAnyPlayerLeaveGame", "玩家"],
    ["player.die", "玩家死亡", "PlayerDie", "玩家"],
    ["player.revive", "玩家复活", "PlayerRevive", "玩家"],
    ["player.move_block", "玩家移动一格", "PlayerMoveOneBlockSize", "玩家"],
    ["player.motion", "玩家动作状态变化", "PlayerMotionStateChange", "玩家"],
    ["player.use_item", "玩家使用道具", "PlayerUseItem", "玩家"],
    ["player.consume_item", "玩家消耗道具", "PlayerConsumeItem", "玩家"],
    ["player.pickup", "玩家拾取道具", "PlayerPickUpItem", "玩家"],
    ["player.drop", "玩家丢弃道具", "PlayerDiscardItem", "玩家"],
    ["player.inventory", "背包道具变化", "PlayerBackPackChange", "玩家"],
    ["player.select_shortcut", "快捷栏选择变化", "PlayerSelectShortcut", "玩家"],
    ["player.click_actor", "玩家点击生物", "PlayerClickMob", "玩家"],
    ["player.attack", "玩家发起攻击", "PlayerAttack", "玩家"],
    ["player.key_down", "玩家按下按键", "PlayerInputKeyDown", "玩家"],
    ["player.key_up", "玩家松开按键", "PlayerInputKeyUp", "玩家"],
    ["block.add", "方块被创建", "BlockAdd", "方块"],
    ["block.destroy", "方块被移除", "BlockRemove", "方块"],
    ["block.click", "玩家点击方块", "PlayerClickBlock", "方块"],
    ["block.dig_begin", "开始挖掘方块", "BlockDigBegin", "方块"],
    ["block.dig_end", "结束挖掘方块", "BlockDigEnd", "方块"],
    ["block.trigger", "方块触发", "BlockTrigger", "方块"],
    ["actor.create", "生物被创建", "MobCreate", "生物"],
    ["actor.die", "生物死亡", "MobDie", "生物"],
    ["actor.hurt", "生物受到伤害", "MobBeHurt", "生物"],
    ["actor.area_in", "生物进入区域", "MobAreaIn", "生物"],
    ["actor.area_out", "生物离开区域", "MobAreaOut", "生物"],
    ["ui.button_click", "界面按钮点击", "UIButtonClick", "界面"],
    ["ui.lost_focus", "输入框失去焦点", "UILostFocus", "界面"],
    ["chat.input", "玩家输入内容", "PlayerNewInputContent", "聊天"]
  ].map(function (row) {
    return {
      id: row[0], kind: "event", title: row[1], category: row[3], compiler: "event",
      eventName: row[2], eventFamily: "TriggerEvent", description: "注册运行时事件 TriggerEvent." + row[2],
      keywords: [row[2], row[1], row[3], "事件"]
    };
  });

  events.push({
    id: "event.custom", kind: "event", title: "自定义运行时事件", category: "高级",
    compiler: "customEvent", description: "直接填写当前运行时支持的事件名。",
    keywords: ["custom", "event", "原生", "自定义事件"],
    fields: [
      select("eventFamily", "事件族", "TriggerEvent", [{ label: "世界 / UI：TriggerEvent", value: "TriggerEvent" }, { label: "对象组件：ObjectEvent", value: "ObjectEvent" }]),
      text("eventName", "事件枚举名", "GameAnyPlayerEnterGame", { required: true, placeholder: "例如 GameAnyPlayerEnterGame" })
    ]
  });

  var conditions = [
    {
      id: "condition.compare", kind: "condition", title: "比较两个值", category: "逻辑",
      compiler: "compare", description: "比较事件字段、变量、数字或其他 Lua 表达式。",
      keywords: ["if", "compare", "等于", "大于", "小于"],
      fields: [
        expression("left", "左值", "event.eventobjid", { required: true }),
        select("operator", "比较符", "==", ["==", "~=", ">", ">=", "<", "<="]),
        expression("right", "右值", "0", { required: true })
      ]
    },
    {
      id: "condition.truthy", kind: "condition", title: "表达式为真", category: "逻辑",
      compiler: "rawCondition", description: "条件必须是合法的 Lua 表达式。",
      keywords: ["boolean", "expression", "布尔", "表达式"],
      fields: [expression("expression", "脚本条件表达式", "true", { required: true, multiline: true })]
    },
    {
      id: "condition.event_field", kind: "condition", title: "事件字段比较", category: "事件数据",
      compiler: "eventFieldCompare", description: "读取 event 表中的字段并比较。字段名会被清理为安全标识符。",
      fields: [
        text("field", "事件字段", "eventobjid", { required: true }),
        select("operator", "比较符", "==", ["==", "~=", ">", ">=", "<", "<="]),
        expression("right", "比较值", "0", { required: true })
      ]
    },
    {
      id: "condition.state_compare", kind: "condition", title: "项目变量比较", category: "变量",
      compiler: "stateCompare", description: "比较编辑器生成的 MW_STATE 项目变量。",
      fields: [
        text("name", "变量名", "score", { required: true }),
        select("operator", "比较符", ">=", ["==", "~=", ">", ">=", "<", "<="]),
        expression("right", "比较值", "10", { required: true })
      ]
    },
    {
      id: "condition.not_nil", kind: "condition", title: "值存在", category: "逻辑",
      compiler: "notNil", description: "判断表达式结果不是 nil。",
      fields: [expression("expression", "脚本表达式", "event.eventobjid", { required: true })]
    },
    {
      id: "condition.range", kind: "condition", title: "数字在范围内", category: "数学",
      compiler: "range", description: "包含最小值和最大值。",
      fields: [
        expression("value", "数值表达式", "0", { required: true }),
        expression("min", "最小值", "0", { required: true }),
        expression("max", "最大值", "100", { required: true })
      ]
    },
    {
      id: "condition.chance", kind: "condition", title: "随机概率", category: "数学",
      compiler: "chance", description: "以 0–100 的百分比决定是否执行。",
      fields: [number("percent", "概率（%）", 50, { min: 0, max: 100, required: true })]
    },
    {
      id: "condition.string_match", kind: "condition", title: "文本包含", category: "文本",
      compiler: "stringContains", description: "使用 string.find 的纯文本模式查找。",
      fields: [
        expression("haystack", "文本表达式", "event.content", { required: true }),
        text("needle", "要查找的文本", "你好", { required: true })
      ]
    }
  ];

  var actions = [
    {
      id: "action.chat_system", kind: "action", title: "发送系统消息", category: "消息",
      compiler: "api", description: "调用 UGC 3.0 Chat:SendSystemMsg。",
      api: { receiver: "Chat", method: "SendSystemMsg", args: ["message", "target"] },
      fields: [text("message", "消息内容", "欢迎来到迷你世界！", { required: true }), expression("target", "目标玩家", "event.eventobjid", { required: true })]
    },
    {
      id: "action.player_gain_item", kind: "action", title: "给予玩家道具", category: "玩家",
      compiler: "api", description: "调用 UGC 3.0 Backpack:AddItem。",
      api: { receiver: "Backpack", method: "AddItem", args: ["player", "itemId", "count", "priority"] },
      fields: [expression("player", "玩家 ID", "event.eventobjid", { required: true }), number("itemId", "道具 ID", 1, { min: 0 }), number("count", "数量", 1, { min: 1 }), number("priority", "优先级类型", 1)]
    },
    {
      id: "action.player_remove_item", kind: "action", title: "移除背包道具", category: "玩家",
      compiler: "api", description: "调用 UGC 3.0 Backpack:RemoveGridItemByItemID。",
      api: { receiver: "Backpack", method: "RemoveGridItemByItemID", args: ["player", "itemId", "count"] },
      fields: [expression("player", "玩家 ID", "event.eventobjid", { required: true }), number("itemId", "道具 ID", 1, { min: 0 }), number("count", "数量", 1, { min: 1 })]
    },
    {
      id: "action.player_set_position", kind: "action", title: "设置玩家位置", category: "玩家",
      compiler: "api", description: "玩家也是 Actor；调用 UGC 3.0 Actor:SetPosition。",
      api: { receiver: "Actor", method: "SetPosition", args: ["player", "x", "y", "z"] },
      fields: [expression("player", "玩家 ID", "event.eventobjid", { required: true }), expression("x", "X", "0"), expression("y", "Y", "10"), expression("z", "Z", "0")]
    },
    {
      id: "action.actor_set_position", kind: "action", title: "设置生物位置", category: "生物",
      compiler: "api", description: "调用 UGC 3.0 Actor:SetPosition。",
      api: { receiver: "Actor", method: "SetPosition", args: ["actor", "x", "y", "z"] },
      fields: [expression("actor", "生物 ID", "event.eventobjid", { required: true }), expression("x", "X", "0"), expression("y", "Y", "10"), expression("z", "Z", "0")]
    },
    {
      id: "action.actor_kill", kind: "action", title: "移除 / 击败生物", category: "生物",
      compiler: "api", description: "调用 UGC 3.0 Actor:KillSelf。",
      api: { receiver: "Actor", method: "KillSelf", args: ["actor"] },
      fields: [expression("actor", "生物 ID", "event.eventobjid", { required: true })]
    },
    {
      id: "action.actor_damage", kind: "action", title: "对生物造成伤害", category: "生物",
      compiler: "api", description: "调用 UGC 3.0 Actor:ActorHurt。",
      api: { receiver: "Actor", method: "ActorHurt", args: ["actor", "source", "damage", "attackType", "ignoreResist", "ignoreEvent"] },
      fields: [expression("actor", "受击生物 ID", "event.toobjid", { required: true }), expression("source", "攻击来源 ID", "event.eventobjid"), number("damage", "伤害", 10, { min: 0 }), number("attackType", "攻击类型", 0), select("ignoreResist", "忽略抗性", "false", [{ label: "否", value: "false" }, { label: "是", value: "true" }], { valueType: "expression" }), select("ignoreEvent", "忽略触发事件", "false", [{ label: "否", value: "false" }, { label: "是", value: "true" }], { valueType: "expression" })]
    },
    {
      id: "action.world_spawn_item", kind: "action", title: "为对象创建道具实例", category: "世界",
      compiler: "api", description: "调用 UGC 3.0 Backpack:CreateItem。",
      api: { receiver: "Backpack", method: "CreateItem", args: ["actor", "itemId", "count", "position"] },
      fields: [expression("actor", "对象 ID", "event.eventobjid", { required: true }), number("itemId", "道具 ID", 1, { min: 0 }), number("count", "数量", 1, { min: 1 }), number("position", "位置类型", 0)]
    },
    {
      id: "action.world_spawn_actor", kind: "action", title: "在世界生成生物", category: "世界",
      compiler: "api", description: "调用 UGC 3.0 World:SpawnCreature。",
      api: { receiver: "World", method: "SpawnCreature", args: ["x", "y", "z", "actorId", "count", "trigger", "worldId"] },
      fields: [expression("x", "X", "0"), expression("y", "Y", "10"), expression("z", "Z", "0"), number("actorId", "生物 ID", 1, { min: 0 }), number("count", "数量", 1, { min: 1 }), select("trigger", "触发创建事件", "true", [{ label: "是", value: "true" }, { label: "否", value: "false" }], { valueType: "expression" }), expression("worldId", "世界 ID", "event.eventworldid or 0")]
    },
    {
      id: "action.block_set", kind: "action", title: "放置方块", category: "方块",
      compiler: "api", description: "调用 UGC 3.0 Block:PlaceBlock。",
      api: { receiver: "Block", method: "PlaceBlock", args: ["blockId", "x", "y", "z", "face", "color", "worldId", "trigger"] },
      fields: [number("blockId", "方块 ID", 1, { min: 0 }), expression("x", "X", "event.x"), expression("y", "Y", "event.y"), expression("z", "Z", "event.z"), number("face", "朝向", 0), number("color", "颜色", 0), expression("worldId", "世界 ID", "event.eventworldid or 0"), select("trigger", "触发方块事件", "true", [{ label: "是", value: "true" }, { label: "否", value: "false" }], { valueType: "expression" })]
    },
    {
      id: "action.block_destroy", kind: "action", title: "破坏方块", category: "方块",
      compiler: "api", description: "调用 UGC 3.0 Block:DestroyBlock。",
      api: { receiver: "Block", method: "DestroyBlock", args: ["x", "y", "z", "drop", "worldId", "trigger"] },
      fields: [expression("x", "X", "event.x"), expression("y", "Y", "event.y"), expression("z", "Z", "event.z"), select("drop", "是否掉落", "true", [{ label: "是", value: "true" }, { label: "否", value: "false" }], { valueType: "expression" }), expression("worldId", "世界 ID", "event.eventworldid or 0"), select("trigger", "触发方块事件", "true", [{ label: "是", value: "true" }, { label: "否", value: "false" }], { valueType: "expression" })]
    },
    {
      id: "action.state_set", kind: "action", title: "设置项目变量", category: "变量",
      compiler: "stateSet", description: "将值保存在脚本级 MW_STATE 表中。",
      fields: [text("name", "变量名", "score", { required: true }), expression("value", "值表达式", "0", { required: true })]
    },
    {
      id: "action.state_add", kind: "action", title: "项目变量增加", category: "变量",
      compiler: "stateAdd", description: "变量不存在时按 0 处理。",
      fields: [text("name", "变量名", "score", { required: true }), expression("amount", "增加量", "1", { required: true })]
    },
    {
      id: "action.local_set", kind: "action", title: "设置脚本局部变量", category: "变量",
      compiler: "localSet", description: "变量名会被清理；仅在当前事件回调中可用。",
      fields: [text("name", "变量名", "value", { required: true }), expression("value", "值表达式", "event.eventobjid", { required: true })]
    },
    {
      id: "action.print", kind: "action", title: "调试输出", category: "调试",
      compiler: "print", description: "使用 print 输出到脚本日志。",
      fields: [expression("value", "要输出的表达式", "event.eventobjid", { required: true })]
    },
    {
      id: "action.comment", kind: "action", title: "代码注释", category: "组织",
      compiler: "comment", description: "在 Lua 输出中添加单行注释。",
      fields: [text("text", "注释", "这里写说明")]
    },
    {
      id: "action.native_api", kind: "action", title: "原生接口调用", category: "高级",
      compiler: "nativeApi", description: "覆盖未收录接口。模块、方法和参数必须按实际运行时 API 填写。",
      keywords: ["raw", "native", "api", "全部接口", "原生调用"],
      fields: [
        text("receiver", "接口模块", "Player", { required: true, placeholder: "例如 Player" }),
        select("callStyle", "调用方式", ":", [{ label: "冒号（对象方法）", value: ":" }, { label: "点号（静态方法）", value: "." }]),
        text("method", "方法名", "getPosition", { required: true }),
        text("args", "参数（脚本表达式列表）", "event.eventobjid", { placeholder: "例如 event.eventobjid, 1" }),
        text("capture", "接收结果（可选）", "", { placeholder: "例如 result" })
      ]
    },
    {
      id: "action.native_lua", kind: "action", title: "原生脚本代码", category: "高级",
      compiler: "nativeLua", description: "原样插入 Lua。用于高级逻辑；请自行保证代码和运行时接口正确。",
      keywords: ["raw", "lua", "code", "脚本", "高级"],
      fields: [{ key: "code", label: "脚本代码", type: "textarea", default: "-- 在这里输入 Lua", required: true, rows: 8 }]
    }
  ];

  var catalog = {
    schemaVersion: 1,
    runtime: {
      name: "中国版迷你世界 3.0 脚本",
      componentShell: "Script:AddTriggerEvent",
      notice: "已载入中国版迷你世界 3.0 公开文档快照中的全部事件、可调用方法与稳定组件属性；客户端更新后请重新核对官方文档。"
    },
    kinds: [
      { id: "event", label: "事件", color: "#ffb454" },
      { id: "condition", label: "条件", color: "#a78bfa" },
      { id: "action", label: "动作", color: "#4fd1c5" }
    ],
    nodes: events.concat(conditions, actions)
  };

  global.MINIWORLD_API_CATALOG = catalog;
  if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
    global.dispatchEvent(new global.CustomEvent("miniworld-catalog-ready", { detail: catalog }));
  }
})(typeof window !== "undefined" ? window : globalThis);
