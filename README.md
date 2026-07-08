# Zephyr · 音乐

> 基于 Tauri 2 + Vue 3 的网易云音乐第三方桌面播放器。

一个现代化的桌面音乐播放器，深度集成网易云音乐生态。采用 NeteaseMusicNext 风格的界面设计，支持浅色/深色主题切换。支持二维码/手机/邮箱登录、歌单同步、逐字歌词（按单词整体擦除）、听歌打卡、喜欢/收藏、评论查看、歌词选择复制、可自定义榜单精选，以及本地音频文件播放。

---

## ✨ 功能特性

### 🎨 界面与主题（NeteaseMusicNext 风格）
- **浅色/深色主题**：默认浅色主题，标题栏 sun/moon 图标一键切换（light → dark → auto）
- **全局 UI 统一**：圆角药丸按钮、表头大写小字、行 hover 才显操作按钮
- **黑色"播放全部"按钮**：NeteaseMusicNext 标志性黑色药丸按钮（浅色主题）/ 红色（深色主题）
- **全屏壁纸**：自定义壁纸应用到所有非播放界面（首页/搜索/歌单/推荐等），播放界面保持独立背景
- **毛玻璃效果**：有壁纸时主内容区歌曲列表行采用毛玻璃半透明

### 🎵 网易云音乐集成
- **多方式登录**：扫码登录 / 手机号+验证码 / 邮箱登录
- **歌单同步**：自动加载用户歌单、每日推荐、听歌排行（最近一周/所有时间）
- **歌单详情页**：歌曲列表 / 评论（含总数）/ 收藏者（含总数）三个标签页
- **推荐页**：每日推荐 + 私人漫游 + 私人雷达 + 推荐歌单 + **可自定义榜单精选**
- **逐字歌词**：yrc 格式**按单词整体擦除**动画（不按字母），支持翻译歌词（tlyric）
- **音质选择**：9 个等级（standard / higher / exhigh / lossless / hires / jyeffect / sky / dolby / jymaster）
  - **Hi-Res 金色按钮**：音质为 Hi-Res 时播放界面音质按钮变金色渐变 + 光晕
  - 无损/超清母带等高品质音质时按钮变银白色微光
- **听歌打卡**：双 API 打卡（`/scrobble/v1` 同步播放时长 + `/scrobble` 记录到最近播放）
- **喜欢功能**：单曲喜欢/取消，缓存 likelist，列表内快捷切换，已喜欢红心常驻显示
- **添加到歌单**：右键菜单 / 列表按钮，弹出对话框选择目标歌单
- **搜索**：支持单曲/专辑/歌手/歌单/用户/MV/歌词/综合多类型筛选
- **用户信息**：VIP 信息 + 总听歌时长 + 用户等级（含进度条）
- **歌单管理**：从歌单移除歌曲（确认对话框）

### 📊 可自定义榜单精选
- **18 个预设榜单**：飙升榜、新歌榜、热歌榜、抖音排行榜、全球说唱榜、欧美热歌榜、古典榜、电音榜、中文说唱榜、潮流风向榜、音乐合伙人系列（5个）、黑胶VIP爱听榜、ACG榜、韩语榜
- **自定义歌单 ID 添加**：输入网易云歌单 ID 即可添加（名称自动从 API 获取）
- **编辑模式**：标题右侧 edit.svg 图标，点击进入编辑模式
  - 卡片边框变红色 + 显示删除按钮
  - 编辑模式下显示 +号添加卡片（未满 6 个时）
- **最多 6 个榜单**，配置持久化到 localStorage
- **添加对话框**：只能用 close.svg 图标关闭（不能点背景关闭）

### 🎴 统一音乐卡片格式
所有视图的歌曲行使用统一的操作按钮组，放在「标题」和「艺术家」之间：
- ❤️ **喜欢** — 已喜欢时常驻红色显示；未喜欢时 hover 行才显示
- 📁 **添加至歌单** — hover 行才显示
- ⏭️ **下一首播放**（= 加入队列）— **始终显示**，无论是否 hover、无论是否喜欢
- **榜单精选例外**：只显示喜欢按钮（空间有限）

### 🎤 歌词选择模式（像聊天记录多选）
- **右键歌词进入**选择模式
- 进入后**停止自动滚动**（冻结当前播放位置，不自动回正）
- **左键点击**歌词行 → 选中/取消选中（高亮背景切换，无勾选框）
- 选择模式下：**取消模糊效果**、所有行 scale=1、**扩大歌词间距**（+16px）
- 顶部提示条：已选 X 行 + 全选按钮 + 复制按钮 + 退出按钮
- **复制成功后 Toast 通知**「复制成功 · 已复制 X 行歌词到剪贴板」
- 复制内容包含歌词原文 + 翻译（如果翻译开启）
- Esc 或点击「退出」按钮退出选择模式

### 🌐 翻译开关
- 播放界面**右下角**翻译开关按钮（translate.svg 图标）
- **默认隐藏**，鼠标进入右下角热区时显示
- **未开启**：hover 效果跟播放控件一致（10% 白色背景）
- **开启**：白色高亮背景（22% 白色），图标固定白色
- 图标颜色始终固定白色

### 播放
- **本地播放**：通过 Rust Rodio 后端播放本地音频文件（mp3/flac/wav/ogg/m4a/aac/opus）
- **在线播放**：网易云歌曲动态获取播放 URL
- **播放模式**：顺序播放 / 列表循环 / 单曲循环 / 随机播放
- **播放队列**：右侧滑入队列弹窗，支持右键菜单
- **会话恢复**：播放队列、进度、音量自动保存到 localStorage，**重启后自动恢复播放** + 恢复到上次进度

### 全屏播放界面
- **逐字歌词**：yrc 解析，按单词整体擦除（`background-clip:text` + `box-decoration-break:clone`），rAF 逐帧驱动
- **翻译歌词**：tlyric 按时间戳匹配，独立存储，右下角一键开关
- **歌词选择模式**：右键进入，点击选中整行，可复制
- **歌词 hover**：鼠标悬停行放大+变亮+减模糊
- **封面展示**：支持矩形/圆形，可调清晰度（200-500p）
- **音频可视化**：bars/lines/wave 三种样式，accent/white/rainbow/album 四种配色
- **背景系统**：模糊（专辑封面）/ 流体 / 渐变 / 纯色 / 无（播放界面保持独立背景，不被全局壁纸覆盖）
- **控件自动隐藏**：鼠标静止时控件淡出，移动时恢复

### 首页（独立设置）
- **全屏壁纸**：自定义本地图片或 URL 作为壁纸，覆盖所有非播放界面
  - 可调模糊强度、变暗程度、缩放模式（填充/适应）
  - 侧边栏透明开关（壁纸透出）
- **主题色**：首页独立的主题色配置（8 预设 + 自定义）
- **字体缩放**：首页内容字体缩放
- **与播放界面设置完全独立**：两套设置互不影响，各自存储

### 其他
- **Toast 通知**：右下角弹出，支持标题/副标题/时长/类型/操作链接
- **返回导航**：基于视图历史栈的返回按钮
- **全局右键菜单禁用**：自定义右键菜单替代原生（播放界面歌词区除外）
- **标题栏拖动**：`data-tauri-drag-region` 自定义标题栏
- **日志系统**：输出到 `exe目录/log/[时间].log`
- **窗口控件**：最小化/最大化/关闭
- **单文件 .exe**：所有逻辑静态链接进单个可执行文件（无 zephyr_music_lib.dll 依赖）

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri 2.x |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 状态管理 | Pinia |
| 后端 | Rust + Rodio (音频) + Lofty (元数据) |
| 音乐 API | 网易云音乐 api-enhanced 服务 |
| 包管理器 | pnpm 11.8.0 |
| 交叉编译 | LLVM-MinGW (Clang 22.1.8, UCRT) |

---

## 📦 项目结构

```
Zephyr-Music/
├── src/                           # Vue 前端源码
│   ├── api/                       # API 封装
│   │   ├── netease/               # 网易云 API 模块化
│   │   │   ├── core.ts            # API 基础请求 + cookie 管理
│   │   │   ├── auth.ts            # 登录（扫码/手机/邮箱）
│   │   │   ├── song.ts            # 歌曲 URL/详情/打卡/记录
│   │   │   ├── playlist.ts        # 歌单详情/操作
│   │   │   ├── lyric.ts           # 歌词（yrc/lrc/tlyric）
│   │   │   ├── search.ts          # 搜索
│   │   │   ├── like.ts            # 喜欢/likelist
│   │   │   ├── comment.ts         # 评论
│   │   │   ├── user.ts            # 用户信息/等级/VIP
│   │   │   └── transform.ts       # 数据转换
│   │   ├── netease.ts             # 网易云 API 统一导出
│   │   ├── music.ts               # 本地音乐元数据
│   │   └── localMusic.ts          # 本地文件选择
│   ├── components/                # Vue 组件
│   │   ├── NowPlayingView.vue     # 全屏播放界面（逐字歌词+可视化+封面+歌词选择模式+翻译开关）
│   │   ├── PlayerBar.vue          # 底部播放栏（控件+音质+音量+喜欢+队列弹窗）
│   │   ├── NeteaseView.vue        # 歌单歌曲列表+详情标签页+右键菜单+统一卡片按钮
│   │   ├── RecommendView.vue      # 推荐页（每日推荐+私人漫游+私人雷达+推荐歌单+可自定义榜单精选）
│   │   ├── SearchView.vue         # 搜索页（类型筛选+右键菜单+统一卡片按钮）
│   │   ├── Sidebar.vue            # 侧边栏（推荐/我的/歌单列表）
│   │   ├── SettingsPanel.vue      # 播放界面设置（外观/封面/背景/歌词/字体/杂项/实验性）
│   │   ├── HomeSettingsPanel.vue  # 首页设置（壁纸/主题色/字体，独立于播放界面）
│   │   ├── GlobalSearchBar.vue    # 顶部搜索栏
│   │   ├── QueueView.vue          # 播放队列弹窗
│   │   ├── LibraryView.vue        # 本地音乐库
│   │   ├── ToastContainer.vue     # Toast 通知容器
│   │   ├── Slider.vue             # 通用滑块（支持竖向）
│   │   ├── WindowControls.vue     # 窗口控制按钮
│   │   └── Icon.vue               # SVG 图标组件（含 sun/moon 等）
│   ├── composables/               # 组合式 API
│   │   ├── useAudioBinding.ts     # 音频绑定（Rodio + audio 双模式 + 听歌打卡 + 重启恢复）
│   │   ├── useAudioVisualizer.ts  # 音频可视化（模拟频谱）
│   │   ├── useHomeSettings.ts     # 首页设置（独立 localStorage）
│   │   ├── useToast.ts            # Toast 通知系统
│   │   ├── useNeteaseAuth.ts      # 网易云登录状态管理
│   │   ├── useNeteaseUser.ts      # 网易云用户信息（VIP/等级/听歌时长）
│   │   ├── useWindowControls.ts   # 窗口控制（最小化/最大化/关闭）
│   │   ├── rodioBridge.ts         # Rodio Tauri 命令封装
│   │   ├── logger.ts              # 日志（输出到 Rust 文件）
│   │   └── utils.ts               # 工具函数
│   ├── stores/player.ts           # Pinia 状态管理（含视图历史栈 + 会话保存/恢复）
│   ├── types/                     # 类型定义
│   ├── style.css                  # 全局样式（NeteaseMusicNext 主题 + 浅色/深色）
│   ├── nmn-overrides.css          # NeteaseMusicNext UI 覆盖样式
│   └── main.ts                    # 入口文件
├── src-tauri/                     # Rust 后端
│   ├── src/lib.rs                 # Rodio + 日志 + localaudio 协议
│   ├── src/main.rs                # 入口（单文件 exe，无 cdylib）
│   ├── Cargo.toml                 # Rust 依赖（crate-type: staticlib + rlib）
│   ├── tauri.conf.json            # Tauri 配置（CSP + assetProtocol）
│   └── .cargo/config.toml         # 交叉编译配置（LLVM-MinGW）
├── public/icons/                  # 图标资源
│   ├── edit.svg                   # 编辑图标（榜单精选）
│   ├── close.svg                  # 关闭图标（添加榜单对话框）
│   ├── translate.svg              # 翻译开关图标
│   ├── like.svg / not_like.svg    # 喜欢/未喜欢图标
│   ├── add_playlist.svg           # 添加到歌单图标
│   └── ...
├── package.json                   # pnpm 11.8.0
├── pnpm-lock.yaml                 # pnpm 锁文件
├── pnpm-workspace.yaml            # pnpm 配置
├── vite.config.ts
└── tsconfig.json
```

---

## 🚀 开发与构建

### 环境要求
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 11+ （**必须使用 pnpm**，不要用 npm/yarn）
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

### 交叉编译 Windows x64 (Linux 环境，使用 LLVM-MinGW)
```bash
# 安装 Rust windows-gnu target
rustup target add x86_64-pc-windows-gnu

# 安装 LLVM-MinGW 工具链
# https://github.com/mstorsjo/llvm-mingw

# 配置 src-tauri/.cargo/config.toml
[target.x86_64-pc-windows-gnu]
linker = "/path/to/llvm-mingw/bin/x86_64-w64-mingw32-gcc"
ar = "/path/to/llvm-mingw/bin/x86_64-w64-mingw32-ar"
rustflags = [
  "-C", "link-arg=-static",
  "-C", "link-arg=-Wl,--allow-multiple-definition",
  "-C", "link-arg=-Wl,-Bstatic",
  "-C", "link-arg=-lwinpthread",
]

# 创建 libgcc 兼容符号链接（LLVM-MinGW 用 libunwind 替代 libgcc）
cd /path/to/llvm-mingw/x86_64-w64-mingw32/lib/
ln -sf libunwind.a libgcc.a
ln -sf libunwind.a libgcc_eh.a
ln -sf libunwind.a libgcc_s.a

# 设置 include 路径（ring 编译需要）
export C_INCLUDE_PATH="/path/to/llvm-mingw/generic-w64-mingw32/include"
export CPLUS_INCLUDE_PATH="$C_INCLUDE_PATH"

# 构建（需 custom-protocol feature 嵌入前端）
cargo build --release --target x86_64-pc-windows-gnu --features custom-protocol
```

产物为单文件 `zephyr-music.exe`（~20MB），无需 `zephyr_music_lib.dll`。

---

## 📖 使用说明

### 首次使用
1. **登录网易云**：点击标题栏「登录」按钮，选择扫码/手机/邮箱登录
2. **浏览歌单**：左侧侧边栏选择「推荐」查看推荐歌单和榜单，或「我的」查看自己的歌单
3. **设置壁纸**：点击标题栏设置图标 → 「背景壁纸」→ 选择本地图片或输入 URL
4. **切换主题**：标题栏 sun/moon 图标，循环 light → dark → auto

### 播放音乐
- **歌单播放**：点击歌单查看歌曲列表，双击歌曲播放，或点击「播放全部」
- **搜索播放**：顶部搜索栏输入关键词，回车搜索，支持多类型筛选
- **榜单播放**：推荐页「榜单精选」点击榜单标题进入详情，或直接点击榜单内歌曲
- **本地播放**：搜索页点击「打开本地文件」选择本地音频

### 歌曲操作按钮
在搜索结果、歌单详情的歌曲行上（标题和艺术家之间）：
- ❤️ **喜欢** — 已喜欢时常驻红色，未喜欢时 hover 显示
- 📁 **添加至歌单** — hover 显示，弹出对话框选择歌单
- ⏭️ **下一首播放** — 始终显示，点击加入播放队列

### 榜单精选管理
- **添加榜单**：点击榜单精选标题右侧 edit.svg 图标进入编辑模式 → 点击 +号卡片 → 选择预设或输入自定义 ID
- **删除榜单**：编辑模式下点击卡片右侧删除按钮
- **自定义 ID**：在网易云网页版歌单 URL 中找到 ID（如 `playlist?id=19723756`）

### 歌词选择模式
- **右键歌词** → 进入选择模式（停止自动滚动）
- **左键点击歌词行** → 选中/取消选中
- **点击「全选」** → 选中所有歌词行
- **点击「复制」** → 复制选中歌词到剪贴板 + Toast 通知
- **Esc** 或 **点击「退出」** → 退出选择模式

### 翻译开关
- 鼠标移到播放界面**右下角** → 显示翻译开关按钮
- 点击切换翻译开/关
- 开启时按钮有白色高亮背景

### 快捷键
- `空格`：播放/暂停
- `Esc`：关闭全屏/设置/队列/歌词选择模式
- `Ctrl+→` / `Ctrl+←`：下一首/上一首
- `Ctrl+C`：复制（歌词选择模式下可用）

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

### 榜单精选配置（localStorage: `zephyr-rankings`）
- 用户自定义的榜单列表（ID + 名称），最多 6 个
- 首次使用默认 6 个：飙升榜、新歌榜、热歌榜、抖音排行榜、全球说唱榜、欧美热歌榜

### 会话恢复（localStorage: `zephyr-session`）
- 播放队列、当前歌曲索引、播放进度、音量、静音状态
- 重启后自动恢复：获取新 URL → 恢复进度 → 自动播放

### 网易云 API 配置
`src/api/netease/core.ts` 中的 `API_BASE` 变量：
```ts
export const API_BASE = "https://musicapi.mingqwq.top"; // 你的 api-enhanced 服务地址
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
- [LLVM-MinGW](https://github.com/mstorsjo/llvm-mingw) — LLVM-based MinGW 工具链
- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) — 网易云音乐 API 参考实现
