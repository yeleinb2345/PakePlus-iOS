# 中国版迷你世界 3.0 图形化触发器

一个纯前端、离线可用的图形化事件—条件—动作编辑器。界面借鉴创作工具的工作流，但使用原创视觉与代码；生成目标是中国版迷你世界 UGC 3.0 组件脚本。

## 直接运行

无需安装依赖：

```powershell
node tools\serve.mjs
```

然后打开 `http://127.0.0.1:4173`。也可以直接双击 `index.html`，但浏览器对 `file://` 下的剪贴板权限可能有限。

## 已实现

- 多触发器项目、启用/停用、复制与删除。
- 事件、条件、动作积木的点击添加、拖放、排序和属性编辑。
- 仿创作工具 3.0 的纵向嵌套积木结构，支持“如果—那么—否则”分支。
- 实时 Lua 预览、结构诊断、复制和 `.lua` 下载。
- 项目 JSON 导入/导出、本地自动保存、撤销/重做和示例项目。
- 官方接口搜索与参数表单；保留“原生 API 调用”和“原生 Lua”节点覆盖新接口。
- 桌面三栏工作台与移动端积木库/属性抽屉、纵向流程画布。

2026-08-14 的离线官方文档快照包含：

- 672 个可调用项：21 个主要服务模块、CloudSever、全局/组件/对象函数及 60 个组件专用方法。
- 173 个 `TriggerEvent` 与 71 个 `ObjectEvent`。
- 899 个公开组件字段、8 个官方标注的内部字段。
- 224 个组件枚举值、94 族共 845 个全局枚举值。

快照来源与抓取脚本见 `tools/sync-api.mjs`；重新同步：

```powershell
node tools\sync-api.mjs
```

## 3.0 输出规则

默认输出标准组件壳：

```lua
local Script = {}

function Script:OnStart()
    self:AddTriggerEvent(TriggerEvent.GameStart, self.OnGameStart)
end

function Script:OnGameStart(event)
    event = event or {}
    -- 动作
end

return Script
```

- 世界/UI 组件使用 `AddTriggerEvent(TriggerEvent.X, ...)`。
- 玩家、生物、方块等对象组件使用 `AddEvent(ObjectEvent.X, ...)`。
- 同一脚本混用两类事件会被诊断为错误。
- 自定义资源、UI、预制和组件 ID 必须替换为当前地图 ID 库中的真实值。

## 液态玻璃增强

界面中的液态玻璃层参考并改写自 [martin65536/liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl)，固定参考提交 `79757c60f0f5cc23812a2c85fb9aaeffc87361e5`。原项目采用 Apache License 2.0；完整许可见 `LIQUID_GLASS_LICENSE.txt`，改写说明见 `THIRD_PARTY_NOTICES.md`。

该效果是非交互式的渐进增强：WebGL 可用时以受限分辨率绘制折射与色散，画布不会捕获鼠标或触摸输入；WebGL 不可用、上下文丢失或手动指定 `?glass=fallback` 时自动使用 CSS 回退。系统开启“减少动态效果”后只保留静态帧，不持续动画，因此不会影响积木点击、拖拽、滚动与 Lua 生成。

## 校验与构建

```powershell
node tools\check.mjs
node tools\build.mjs
node --test tests\sites-worker.test.mjs
```

浏览器冒烟测试需要 Playwright：

```powershell
$env:NODE_PATH="C:\Users\XR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
node tests\smoke.cjs
node tests\glass-smoke.cjs
```

## 可验证边界

编辑器能保证内置节点经过确定性转义和结构化生成，并检查缺失事件、必填参数、事件族冲突、未知节点、占位组件 ID 与原生代码节点。浏览器无法模拟迷你世界引擎；地图资源是否存在、云服/权限条件、主客机差异和未来版本变更仍需在目标客户端实测。因此请把“结构检查通过”理解为可导入的候选脚本，而不是对任意地图和未来版本的零缺陷承诺。

本项目是非官方创作辅助工具，不包含迷你世界商标或游戏素材。
