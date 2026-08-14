# 浏览器冒烟测试

测试覆盖 1440×900 桌面端和 390×844 移动端，检查：

- 页面核心区域可见，且无 `console.error` / `pageerror`
- 从节点库添加节点并在属性面板中选中该节点
- 搜索 `Actor.SetPosition` 能命中同步的官方 API
- Lua 输出非空且包含事件注册
- 复制与 `.lua` 下载操作可用
- 移动端节点库抽屉初始收起、点击后进入视口
- 生成 `screenshots/desktop.png` 与 `screenshots/mobile.png`

先启动静态服务器：

```powershell
node tools/serve.mjs
```

另开终端执行：

```powershell
$env:NODE_PATH='C:\Users\XR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tests/smoke.cjs
```

默认地址为 `http://127.0.0.1:4173`。可用 `BASE_URL`、`SMOKE_TIMEOUT` 和
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 环境变量覆盖地址、单步超时（毫秒）与浏览器路径。
测试会优先使用已安装的 Chrome 或 Edge；没有系统浏览器时使用 Playwright 自带 Chromium。
