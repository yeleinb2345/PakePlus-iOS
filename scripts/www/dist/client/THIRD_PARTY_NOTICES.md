# 第三方软件说明

## liquid-glass-webgl

- 项目：`martin65536/liquid-glass-webgl`
- 来源：https://github.com/martin65536/liquid-glass-webgl
- 参考版本：`79757c60f0f5cc23812a2c85fb9aaeffc87361e5`
- 许可证：Apache License 2.0（完整文本见 `LIQUID_GLASS_LICENSE.txt`）
- 原项目版权声明：Copyright 2025 Liquid Glass WebGL Port Contributors

本项目的 `liquid-glass.js` 参考并改写了原项目中圆角矩形有向距离场、表面法线、折射和色散的实现思路。该文件不是原项目 Next.js 应用的直接打包产物，也不依赖原项目的服务端、数据库或界面代码。

为适配本项目，改写版本使用原生 JavaScript 和单个 WebGL 1 画布；从编辑器 DOM 的可见矩形生成最多八个玻璃区域；加入了分辨率与总像素上限、按需重绘、移动设备和“减少动态效果”适配、页面隐藏暂停、WebGL 上下文丢失处理，以及不阻断编辑器交互的 CSS 回退状态。

本项目对上述改写内容所作的修改，不代表原项目作者对本项目提供背书。
