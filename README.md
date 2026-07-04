# Zephyr · 音乐

> 基于 Tauri 2 + Vue 3 的网易云音乐第三方桌面播放器。

一个现代化的桌面音乐播放器，深度集成网易云音乐生态。支持二维码/手机/邮箱登录、歌单同步、逐字歌词、听歌打卡、喜欢/收藏、评论查看，以及本地音频文件播放。采用 Material Design 3 风格的界面设计，紫色主色调。

---

## ✨ 功能特性

### 网易云音乐集成
- **多方式登录**：扫码登录 / 手机号+验证码 / 邮箱登录
- **歌单同步**：自动加载用户歌单、每日推荐、听歌排行（最近一周/所有时间）
- **歌单详情页**：歌曲列表 / 评论（含总数）/ 收藏者（含总数）三个标签页
- **推荐页**：推荐歌单 + 榜单精选（飙升榜 / 新歌榜 / 热歌榜 / 抖音排行榜）
- **逐字歌词**：yrc 格式逐字擦除动画，支持翻译歌词（tlyric）
- **音质选择**：9 个等级（standard / higher / exhigh / lossless / hires / jyeffect / sky / dolby / jymaster）
- **听歌打卡**：自动 scrobble，记录播放来源歌单（sourceid 追踪）
- **喜欢功能**：单曲喜欢/取消，缓存 likelist，列表内快捷切换
- **添加到歌单**：右键菜单 / 列表按钮，弹出对话框选择目标歌单
- **搜索**：支持单曲/专辑/歌手/歌单/用户/MV/歌词/综合多类型筛选
- **用户信息**：VIP 信息 + 总听歌时长 + 用户等级（含进度条）
- **歌单管理**：从歌单移除歌曲（确认对话框）

### 播放
- **本地播放**：通过 Rust Rodio 后端播放本地音频文件（mp3/flac/wav/ogg/m4a/aac/opus）
- **在线播放**：网易云歌曲动态获取播放 URL
- **播放模式**：顺序播放 / 列表循环 / 单曲循环 / 随机播放
- **播放队列**：右侧滑入队列弹窗，支持右键菜单
- **会话恢复**：播放队列、进度、音量自动保存到 localStorage

### 全屏播放界面
- **逐字歌词**：yrc 解析，`background-clip:text` 擦除效果，rAF 逐帧驱动
- **翻译歌词**：tlyric 按时间戳匹配，独立存储
- **歌词 hover**：鼠标悬停行放大+变亮+减模糊
- **封面展示**：支持矩形/圆形，可调清晰度（200-500p）
- **音频可视化**：bars/lines/wave 三种样式，accent/white/rainbow/album 四种配色
- **背景系统**：模糊（专辑封面）/ 流体 / 渐变 / 纯色 / 无
- **控件自动隐藏**：鼠标静止时控件淡出，移动时恢复

### 首页（独立设置）
- **全屏壁纸**：自定义本地图片或 URL 作为壁纸，覆盖整个窗口（含标题栏）
  - 可调模糊强度、变暗程度、缩放模式（填充/适应）
  - 侧边栏透明开关（壁纸透出）
- **主题色**：首页独立的主题色配置（8 预设 + 自定义）
- **字体缩放**：首页内容字体缩放
- **与播放界面设置完全独立**：两套设置互不影响，各自存储

### 其他
- **Toast 通知**：右下角弹出，支持标题/副标题/时长/类型/操作链接
- **返回导航**：基于视图历史栈的返回按钮
- **全局右键菜单禁用**：自定义右键菜单替代原生
- **标题栏拖动**：`data-tauri-drag-region` 自定义标题栏
- **日志系统**：输出到 `exe目录/log/[时间].log`
- **窗口控件**：最小化/最大化/关闭

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri 2.x |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 状态管理 | Pinia |
| 后端 | Rust + Rodio (音频) + Lofty (元数据) |
| 音乐 API | 网易云音乐 api-enhanced 服务 |

---

## 📦 项目结构

```
Zephyr-Music/
├── src/                           # Vue 前端源码
│   ├── api/                       # API 封装
│   │   ├── netease.ts             # 网易云音乐 API（登录/歌单/歌曲/歌词/搜索/喜欢/打卡/评论/收藏者/榜单/等级/VIP）
│   │   ├── music.ts               # 本地音乐元数据
│   │   └── localMusic.ts          # 本地文件选择
│   ├── components/                # Vue 组件
│   │   ├── NowPlayingView.vue     # 全屏播放界面（逐字歌词+可视化+封面）
│   │   ├── PlayerBar.vue          # 底部播放栏（控件+音质+音量+喜欢+队列弹窗）
│   │   ├── NeteaseView.vue        # 歌单歌曲列表+详情标签页+右键菜单
│   │   ├── RecommendView.vue      # 推荐页（推荐歌单+榜单精选+右键菜单）
│   │   ├── SearchView.vue         # 搜索页（类型筛选+右键菜单）
│   │   ├── Sidebar.vue            # 侧边栏（推荐/我的/歌单列表）
│   │   ├── SettingsPanel.vue      # 播放界面设置（外观/封面/背景/歌词/字体/杂项/实验性）
│   │   ├── HomeSettingsPanel.vue  # 首页设置（壁纸/主题色/字体，独立于播放界面）
│   │   ├── GlobalSearchBar.vue    # 顶部搜索栏
│   │   ├── QueueView.vue          # 播放队列弹窗
│   │   ├── LibraryView.vue        # 本地音乐库
│   │   ├── ToastContainer.vue     # Toast 通知容器
│   │   ├── Slider.vue             # 通用滑块（支持竖向）
│   │   └── Icon.vue               # SVG 图标组件
│   ├── composables/               # 组合式 API
│   │   ├── useAudioBinding.ts     # 音频绑定（Rodio + audio 双模式）
│   │   ├── useAudioVisualizer.ts  # 音频可视化（模拟频谱）
│   │   ├── useHomeSettings.ts     # 首页设置（独立 localStorage）
│   │   ├── useToast.ts            # Toast 通知系统
│   │   ├── rodioBridge.ts         # Rodio Tauri 命令封装
│   │   ├── logger.ts              # 日志（输出到 Rust 文件）
│   │   └── utils.ts               # 工具函数
│   ├── stores/player.ts           # Pinia 状态管理（含视图历史栈）
│   ├── types.ts                   # 类型定义
│   └── style.css                  # 全局样式（Material Design 3）
├── src-tauri/                     # Rust 后端
│   ├── src/lib.rs                 # Rodio + 日志 + localaudio 协议
│   ├── Cargo.toml                 # Rust 依赖
│   └── tauri.conf.json            # Tauri 配置（CSP + assetProtocol）
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 🚀 开发与构建

### 环境要求
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9+ (包管理器)
- [Rust](https://www.rust-lang.org/) (stable)
- Tauri 2 前置依赖：参见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)

### 安装依赖
```bash
pnpm install
```

### 开发模式
```bash
pnpm tauri dev
```
启动 Tauri 开发模式，前端热重载 + Rust 自动重编译。

### 仅前端开发
```bash
pnpm dev
```
启动 Vite 开发服务器（浏览器预览，无 Tauri 外壳，本地文件播放不可用）。

### 构建 Windows 发布版
```bash
pnpm tauri build
```
产物在 `src-tauri/target/release/`。

### 交叉编译 Windows x64 (Linux 环境)
```bash
# 安装 Rust windows-gnu target
rustup target add x86_64-pc-windows-gnu

# 安装 llvm-mingw 工具链
# https://github.com/mstorsjo/llvm-mingw

# 构建（需 custom-protocol feature 嵌入前端）
cargo build --release --target x86_64-pc-windows-gnu --features custom-protocol
```

---

## 📖 使用说明

### 首次使用
1. **登录网易云**：点击标题栏「登录」按钮，选择扫码/手机/邮箱登录
2. **浏览歌单**：左侧侧边栏选择「推荐」查看推荐歌单和榜单，或「我的」查看自己的歌单
3. **设置壁纸**：点击标题栏设置图标 → 「背景壁纸」→ 选择本地图片或输入 URL

### 播放音乐
- **歌单播放**：点击歌单查看歌曲列表，双击歌曲播放，或点击「播放全部」
- **搜索播放**：顶部搜索栏输入关键词，回车搜索，支持多类型筛选
- **榜单播放**：推荐页「榜单精选」点击榜单标题进入详情，或直接点击榜单内歌曲
- **本地播放**：搜索页点击「打开本地文件」选择本地音频

### 右键菜单
在歌单列表、搜索结果、榜单精选的歌曲上右键：
- **播放** / **下一首播放**（hover 展开子菜单：下一首/最后一首）
- **喜欢** / **取消喜欢**
- **添加到歌单**（弹出对话框选择目标歌单）
- **从此歌单删除**（仅歌单视图，需确认）

### 歌单详情
进入歌单/榜单详情后，顶部显示歌曲/评论/收藏者三个标签页：
- **歌曲**：歌曲列表，显示播放数/收藏数动态信息 + 歌单描述
- **评论**：评论列表（头像/用户名/内容/点赞数），滚动到底部加载更多
- **收藏者**：收藏者列表（头像/用户名/签名），滚动到底部加载更多

### 全屏播放
点击右上角全屏按钮，或点击底部播放栏：
- 逐字歌词自动滚动，鼠标悬停行放大
- 鼠标静止时控件淡出，移动鼠标恢复
- 点击设置图标打开播放界面设置（独立于首页设置）

### 快捷键
- `空格`：播放/暂停
- `Esc`：关闭全屏/设置/队列
- `Ctrl+→` / `Ctrl+←`：下一首/上一首

---

## 🔧 配置说明

### 首页设置（localStorage: `home-settings`）
- **背景壁纸**：类型（无/壁纸）、本地图片或 URL、模糊强度、变暗程度、缩放模式、侧边栏透明
- **主题色**：首页独立的主题色（8 预设 + 自定义）
- **字体缩放**：首页内容字体缩放（0.8x - 1.4x）

### 播放界面设置（localStorage: `rnp-settings`）
- **外观**：显示模式、配色、主题色、文字阴影/发光
- **封面**：水平/垂直对齐、矩形/圆形、阴影、清晰度
- **背景**：类型（模糊/流体/渐变/纯色/无）、模糊强度、变暗
- **音频可视化**：样式、配色、灵敏度、不透明度、柱体数量
- **歌词**：字号、行间距、3D 旋转、曲率、对齐、动画曲线、翻译显示
- **字体**：字体族（系统/衬线/圆角/等宽/宋体）、缩放
- **杂项**：隐藏控件、封面旋转、平滑歌词滚动
- **实验性**：GPU 加速、调试日志、跳过元数据、低延迟

### 网易云 API 配置
`src/api/netease.ts` 中的 `API_BASE` 变量：
```ts
const API_BASE = "https://musicapi.mingqwq.top"; // 你的 api-enhanced 服务地址
```
如需自建 API 服务，参考 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 或 api-enhanced 版本。

---

## 📝 许可证

GNU Affero General Public License v3.0 (AGPL-3.0)

---

## 🙏 鸣谢

- [Tauri](https://tauri.app/) — 跨平台桌面应用框架
- [Rodio](https://github.com/RustAudio/rodio) — Rust 音频播放库
- [Lofty](https://github.com/Serial-ATA/lofty-rs) — Rust 音频元数据解析
- [Vue 3](https://vuejs.org/) — 渐进式 JavaScript 框架
- [Pinia](https://pinia.vuejs.org/) — Vue 状态管理库
- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) — 网易云音乐 API 参考实现
