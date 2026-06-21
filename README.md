# Zephyr · 音乐

> 受 Apple Music 与 [Refined Now Playing](https://github.com/RNP-Project/refined-now-playing) 启发的桌面音乐播放器。
>
> Tauri 2 + Vue 3 + TypeScript + Rodio (Rust) 后端。

一个本地优先、界面精致的桌面音乐播放器。支持在线搜索（网易云/QQ音乐等）与本地文件播放，带有 RNP 风格的全屏歌词界面、音频可视化背景、完善的设置面板。

---

## ✨ 功能特性

### 播放
- **在线搜索**：通过 qijieya API 搜索网易云、QQ 音乐等平台的音乐
- **本地播放**：通过 Rust Rodio 后端播放本地音频文件（mp3/flac/wav/ogg/m4a/aac/opus）
- **自动获取封面与歌词**：本地文件自动用文件名搜索封面和歌词
- **播放模式**：顺序播放 / 列表循环 / 单曲循环 / 随机播放

### 全屏播放界面 (RNP 风格)
- **歌词引擎**：1:1 移植 RNP 的 `setRotateTransform`，支持 3D 旋转、曲率调节
- **居中锚定**：活动行精确垂直居中，实测高度避免重叠
- **多行支持**：翻译、罗马音显示
- **逐行延迟动画**：stagger 效果
- **多种动画曲线**：平滑 / 迅捷 / 弹跳 / 柔和 / 弹簧

### 音频可视化
- **三种样式**：长方体（bars）/ 线条（lines）/ 波浪（wave）
- **四种配色**：主题色 / 白色 / 彩虹 / 专辑
- **底部条带**：贴屏幕底部，不遮挡歌词和封面
- **模拟频谱**：跟随播放进度、音量、节拍（~120 BPM），不接触音频元素以确保播放稳定
- **性能优化**：32 柱上限、30fps 节流、暂停时自动停止

### 背景系统
- **五种背景类型**：模糊（专辑封面模糊）/ 流体（慢速平移）/ 渐变 / 纯色 / 无
- **可调模糊强度与变暗程度**

### 设置面板
- **8 个标签页**：外观 / 封面 / 背景 / 歌词 / 字体 / 杂项 / 实验性 / 关于
- **双模式**：首页（modal 全屏弹窗）/ 播放界面（sidebar 右侧滑出）
- **持久化**：所有设置保存到 localStorage

### 其他
- **GPU 加速开关**：可切换 GPU 合成层（translateZ/will-change）
- **自定义主题色**：8 种预设 + 自定义颜色
- **日志系统**：输出到 `exe目录/log/[时间].log`
- **窗口控件**：自定义标题栏（最小化/最大化/关闭）

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri 2.x |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 状态管理 | Pinia |
| 后端 | Rust + Rodio (音频) + Lofty (元数据) |
| 音乐 API | [qijieya](https://api.qijieya.cn/meting/) |

---

## 📦 项目结构

```
music-player/
├── src/                        # Vue 前端源码
│   ├── api/                    # 在线搜索/歌词 API
│   ├── components/             # Vue 组件
│   │   ├── NowPlayingView.vue  # 全屏播放界面
│   │   ├── SettingsPanel.vue   # 设置面板
│   │   ├── PlayerBar.vue       # 底部迷你播放器
│   │   ├── SearchView.vue      # 搜索结果页
│   │   ├── Sidebar.vue         # 左侧导航栏
│   │   ├── GlobalSearchBar.vue # 顶部搜索栏
│   │   ├── Slider.vue          # 通用滑块
│   │   └── Icon.vue            # SVG 图标组件
│   ├── composables/            # 组合式 API
│   │   ├── useAudioBinding.ts  # 音频绑定（Rodio + audio 双模式）
│   │   ├── useAudioVisualizer.ts # 音频可视化
│   │   ├── rodioBridge.ts      # Rodio Tauri 命令封装
│   │   ├── logger.ts           # 日志（输出到 Rust 文件）
│   │   └── utils.ts            # 工具函数
│   ├── stores/player.ts        # Pinia 状态管理
│   ├── types.ts                # 类型定义
│   └── style.css               # 全局样式
├── src-tauri/                  # Rust 后端
│   ├── src/lib.rs              # Rodio + 日志 + localaudio 协议
│   ├── Cargo.toml              # Rust 依赖
│   └── tauri.conf.json         # Tauri 配置
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 🚀 开发与构建

### 环境要求
- [Node.js](https://nodejs.org/) 18+
- [Bun](https://bun.sh/) (包管理器)
- [Rust](https://www.rust-lang.org/) (stable)
- Tauri 2 前置依赖：参见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)

### 安装依赖
```bash
cd music-player
bun install
```

### 开发模式
```bash
bun run tauri dev
```
启动 Tauri 开发模式，前端热重载 + Rust 自动重编译。

### 仅前端开发
```bash
bun run dev
```
启动 Vite 开发服务器（浏览器预览，无 Tauri 外壳，本地文件播放不可用）。

### 构建 Windows 发布版
```bash
bun run tauri build --target x86_64-pc-windows-gnu
```
产物在 `src-tauri/target/x86_64-pc-windows-gnu/release/`。

### 构建 macOS / Linux
```bash
bun run tauri build
```

---

## 📖 使用说明

1. **搜索音乐**：在顶部搜索栏输入关键词，回车搜索；或点击下拉结果直接播放
2. **播放本地文件**：点击搜索栏右侧的文件夹图标，选择本地音频文件
3. **全屏播放**：点击右上角全屏按钮，或点击底部播放栏
4. **打开设置**：全屏界面点击齿轮图标，或首页点击设置按钮
5. **键盘快捷键**（全屏界面）：
   - `空格`：播放/暂停
   - `Esc`：关闭全屏/设置/队列
   - `Ctrl+→` / `Ctrl+←`：下一首/上一首

---

## 🔧 配置说明

所有设置保存在 localStorage 的 `rnp-settings` 键下。可通过设置面板调整：

- **外观**：显示模式、配色、主题色、文字阴影/发光
- **封面**：水平/垂直对齐、矩形/圆形、阴影
- **背景**：类型（模糊/流体/渐变/纯色/无）、模糊强度、变暗
- **音频可视化**：样式、配色、灵敏度、不透明度、柱体数量
- **歌词**：字号、行间距、3D 旋转、曲率、对齐、动画曲线
- **字体**：字体族（系统/衬线/圆角/等宽/宋体）、缩放
- **实验性**：GPU 加速、调试日志、跳过元数据、低延迟

---

## 📝 许可证

MIT License

---

## 🙏 鸣谢

- [Refined Now Playing (RNP)](https://github.com/RNP-Project/refined-now-playing) — 歌词引擎灵感来源
- [Apple Music](https://www.apple.com/apple-music/) — 界面设计灵感
- [Tauri](https://tauri.app/) — 跨平台桌面应用框架
- [Rodio](https://github.com/RustAudio/rodio) — Rust 音频播放库
- [qijieya API](https://api.qijieya.cn/) — 音乐数据源
