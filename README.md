# Zephyr · 音乐

> 基于 Tauri 2 + Vue 3 的网易云音乐第三方桌面播放器。

一个现代化的桌面音乐播放器，深度集成网易云音乐生态。采用 NeteaseMusicNext 风格的界面设计，支持浅色/深色主题切换。支持二维码/手机/邮箱登录、歌单同步、逐字歌词（按单词整体擦除）、3D 旋转歌词、听歌打卡、喜欢/收藏、评论查看、歌词选择复制、可自定义榜单精选、个人主页、全屏播放界面，以及本地音频文件播放。

---

## ✨ 功能特性

### 🎨 界面与主题（NeteaseMusicNext 风格）
- **浅色/深色主题**：默认浅色主题，标题栏 sun/moon 图标一键切换（light → dark → auto）
- **全局 UI 统一**：圆角药丸按钮、表头大写小字、行 hover 才显操作按钮
- **黑色"播放全部"按钮**：NeteaseMusicNext 标志性黑色药丸按钮（浅色主题）/ 红色（深色主题）
- **全屏壁纸**：自定义壁纸应用到所有非播放界面（首页/搜索/歌单/推荐等），播放界面保持独立背景
- **毛玻璃效果**：有壁纸时主内容区歌曲列表行采用毛玻璃半透明
- **播放栏玻璃效果**：有壁纸时底部播放栏半透明玻璃效果
- **禁止拖动图片** + **禁用空格键滚动页面**

### 🎵 网易云音乐集成
- **多方式登录**：扫码登录 / 手机号+验证码 / 邮箱登录（POST 请求，密码不在 URL 中）
- **歌单同步**：自动加载用户歌单、每日推荐、听歌排行（最近一周/所有时间）
- **歌单详情页**：歌曲列表 / 评论（含总数）/ 收藏者（含总数）三个标签页
- **推荐页**：每日推荐 + 私人漫游 + 私人雷达 + 推荐歌单 + **可自定义榜单精选**
  - 每日推荐封面用第一首歌封面，子标题显示"每日推荐 | 从[歌名]听起"
  - 私人雷达子标题显示"私人雷达 | 从[第一首歌名]听起"
  - 点击卡片进入详情页，播放按钮单独播放
- **逐字歌词**：yrc 格式**按单词整体擦除**动画（不按字母），支持翻译歌词（tlyric）
- **3D 旋转歌词**：歌词呈半圆弧形排列，支持旋转曲率调节（0-90）、旋转模式专用字号/间距、滚轮弧形旋转滚动
- **音质选择**：9 个等级（standard / higher / exhigh / lossless / hires / jyeffect / sky / dolby / jymaster）
- **听歌打卡**：双 API 打卡（`/scrobble/v1` 同步播放时长 + `/scrobble` 记录到最近播放）
- **喜欢功能**：单曲喜欢/取消，缓存 likelist，列表内快捷切换，已喜欢红心常驻显示
- **添加到歌单**：右键菜单 / 列表按钮，弹出对话框选择目标歌单
- **搜索**：支持单曲/专辑/歌手/歌单/用户/MV/歌词/综合多类型筛选（300ms 防抖）
- **用户信息**：VIP 动画图标 + 总听歌时长 + 用户等级（含进度条）
- **个人主页**：全屏视图，展示用户信息 + 听歌统计 + 我的歌单 + 最近播放 + 听歌排行（3分钟缓存 + 刷新按钮）
- **歌单管理**：从歌单移除歌曲（确认对话框）
- **外部链接跳转**：GitHub 仓库 / 项目 Star / 抖音主页（通过 opener 插件调用系统浏览器）

### 📊 可自定义榜单精选
- **18 个预设榜单**：飙升榜、新歌榜、热歌榜、抖音排行榜、全球说唱榜、欧美热歌榜、古典榜、电音榜、中文说唱榜、潮流风向榜、音乐合伙人系列（5个）、黑胶VIP爱听榜、ACG榜、韩语榜
- **自定义歌单 ID 添加**：输入网易云歌单 ID 即可添加（名称自动从 API 获取）
- **编辑模式**：标题右侧 edit.svg 图标，点击进入编辑模式
- **最多 6 个榜单**，配置持久化到 localStorage
- **hover 三按钮**：喜欢 / 添加至歌单 / 下一首播放（覆盖在卡片最右侧）

### 🎤 歌词选择模式（像聊天记录多选）
- **右键歌词进入**选择模式
- 进入后**停止自动滚动**（冻结当前播放位置，不自动回正）
- **左键点击**歌词行 → 选中/取消选中
- 选择模式下：取消模糊效果、所有行 scale=1、扩大歌词间距
- 顶部提示条：已选 X 行 + 全选按钮 + 复制按钮 + 退出按钮
- **复制成功后 Toast 通知**

### 🌐 翻译开关
- 播放界面右下角翻译开关按钮
- 默认隐藏，鼠标进入右下角热区时显示

### 播放
- **本地播放**：通过 Rust Rodio 后端播放本地音频文件（mp3/flac/wav/ogg/m4a/aac/opus）
- **在线播放**：网易云歌曲动态获取播放 URL
- **播放模式**：顺序播放 / 列表循环（默认）/ 单曲循环 / 随机播放
- **播放队列**：三处播放列表（全屏队列视图 / 首页底部弹窗 / 播放界面面板），支持拖拽排序、复位键
- **会话恢复**：播放队列只保存歌曲 ID 和名称（不保存 URL），重启后自动获取新 URL，**无需手动清除歌单**
- **启动后自动播放**：可在设置中开启（默认关闭）

### 全屏播放界面（已拆分为子组件）
- **逐字歌词**：yrc 解析，按单词整体擦除，rAF 逐帧驱动
- **3D 旋转歌词**：半圆弧形排列，曲率可调（0-90），旋转模式专用字号/间距，滚轮弧形旋转
- **歌词选择模式**：右键进入，点击选中整行，可复制
- **歌词 hover**：鼠标悬停行放大+变亮+减模糊
- **封面展示**：支持矩形/圆形，可调清晰度，响应式缩放
- **背景系统**：模糊（专辑封面）/ 流体 / 渐变 / 纯色 / 无
- **控件自动隐藏**：鼠标静止时控件淡出，移动时恢复
- **播放列表面板**：从右侧居中弹出，支持拖拽排序 + 复位键

### 首页设置（main-view 内嵌视图，非弹窗）
- **全屏壁纸**：自定义本地图片或 URL，覆盖所有非播放界面（含标题栏）
  - 可调模糊强度、变暗程度、缩放模式（填充/适应，均覆盖整个窗口）
  - 侧边栏透明开关
- **主题色**：首页独立的主题色配置（8 预设 + 自定义）
- **字体缩放**：首页内容字体缩放
- **启动后自动播放**：开关（默认关闭）
- **与播放界面设置完全独立**

### 其他
- **Toast 通知**：右下角弹出
- **返回导航**：基于视图历史栈的返回按钮
- **侧边栏选中效果**：听歌排行/我喜欢的音乐/歌单列表高亮
- **标题栏拖动**：自定义标题栏
- **日志系统**：输出到 appDataDir/log/，自动轮转（5MB 清理，最多保留 5 个）
- **窗口控件**：最小化/最大化/关闭
- **单文件 .exe**：所有逻辑静态链接进单个可执行文件

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri 2.x |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 状态管理 | Pinia |
| 后端 | Rust + Rodio (音频) + Lofty (元数据) + Reqwest (HTTP) |
| 音乐 API | 网易云音乐 api-enhanced 服务 + NCBL 加密 |
| 外部链接 | tauri-plugin-opener |
| 包管理器 | pnpm 11.8.0 |
| 交叉编译 | LLVM-MinGW (Clang 22.1.8, UCRT) |

---

## 📦 项目结构

```
Zephyr-Music/
├── src/                           # Vue 前端源码
│   ├── api/                       # API 封装
│   │   ├── netease/               # 网易云 API 模块化
│   │   │   ├── core.ts            # API 基础请求 + cookie 管理 + 输入清洗
│   │   │   ├── auth.ts            # 登录（扫码/手机/邮箱，POST 请求）
│   │   │   ├── song.ts            # 歌曲 URL/详情/打卡/记录
│   │   │   ├── playlist.ts        # 歌单详情/操作（Promise 共享缓存）
│   │   │   ├── lyric.ts           # 歌词（yrc/lrc/tlyric）
│   │   │   ├── search.ts          # 搜索
│   │   │   ├── like.ts            # 喜欢/likelist（Promise 共享缓存）
│   │   │   ├── comment.ts         # 评论
│   │   │   ├── user.ts            # 用户信息/等级/VIP/详情
│   │   │   └── transform.ts       # 数据转换
│   │   ├── netease.ts             # 网易云 API 统一导出
│   │   ├── music.ts               # 本地音乐元数据
│   │   └── localMusic.ts          # 本地文件选择
│   ├── components/                # Vue 组件
│   │   ├── NowPlaying/            # 全屏播放界面子组件（拆分自 NowPlayingView）
│   │   │   ├── useNowPlaying.ts   # 共享状态 composable
│   │   │   ├── NpBackground.vue   # 背景层
│   │   │   ├── NpTopbar.vue       # 顶栏 + 歌词选择提示 + 翻译开关
│   │   │   ├── NpCoverControls.vue # 封面 + 控制按钮 + 音量/进度/音质
│   │   │   ├── NpLyrics.vue       # 歌词（解析/渲染/3D旋转/选择模式）
│   │   │   └── NpQueuePanel.vue   # 播放列表面板（拖拽排序 + 复位键）
│   │   ├── NowPlayingView.vue     # 全屏播放界面主组件（组合子组件）
│   │   ├── PlayerBar.vue          # 底部播放栏（控件+音质+音量+喜欢+队列弹窗+拖拽排序）
│   │   ├── NeteaseView.vue        # 歌单歌曲列表+详情标签页+右键菜单
│   │   ├── RecommendView.vue      # 推荐页（每日推荐+私人漫游+私人雷达+榜单精选）
│   │   ├── SearchView.vue         # 搜索页
│   │   ├── ProfileView.vue        # 个人主页（用户信息+歌单+最近播放+听歌排行）
│   │   ├── Sidebar.vue            # 侧边栏（推荐/我的/歌单列表+选中效果）
│   │   ├── SettingsPanel.vue      # 播放界面设置
│   │   ├── HomeSettingsPanel.vue  # 首页设置（main-view 内嵌视图）
│   │   ├── GlobalSearchBar.vue    # 顶部搜索栏（300ms 防抖）
│   │   ├── QueueView.vue          # 播放队列视图（拖拽排序 + 复位键）
│   │   ├── LibraryView.vue        # 本地音乐库
│   │   └── ...
│   ├── composables/               # 组合式 API
│   │   ├── useSettings.ts         # 播放界面设置（提取自 SettingsPanel）
│   │   ├── useHomeSettings.ts     # 首页设置（含 autoPlayOnStartup）
│   │   ├── useAudioBinding.ts     # 音频绑定（Rodio + audio 双模式 + 听歌打卡）
│   │   ├── useDebounce.ts         # 通用防抖
│   │   ├── useNeteaseAuth.ts      # 网易云登录状态管理
│   │   ├── useNeteaseUser.ts      # 网易云用户信息（VIP/等级/听歌时长/详情）
│   │   └── ...
│   ├── stores/player.ts           # Pinia 状态管理（含会话保存/恢复 + 拖拽排序）
│   ├── types/                     # 类型定义
│   ├── utils/format.ts            # 工具函数（truncateForLog 统一定义）
│   ├── style.css                  # 全局样式
│   ├── nmn-overrides.css          # NeteaseMusicNext UI 覆盖样式
│   └── main.ts                    # 入口文件
├── src-tauri/                     # Rust 后端
│   ├── src/lib.rs                 # Rodio + 日志（轮转）+ localaudio 协议
│   ├── src/netease_report.rs      # NCBL 加密听歌时长上报
│   ├── src/main.rs                # 入口（单文件 exe）
│   ├── Cargo.toml                 # Rust 依赖（opt-level 3, codegen-units 1）
│   ├── tauri.conf.json            # Tauri 配置（CSP + dragDropEnabled false）
│   ├── capabilities/default.json  # 权限配置
│   └── .cargo/config.toml         # 交叉编译配置（LLVM-MinGW）
├── public/icons/                  # 图标资源
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json                  # noUnusedLocals/noUnusedParameters = true
├── eslint.config.mjs              # ESLint 配置
├── .prettierrc                    # Prettier 配置
└── .prettierignore
```

---

## 🚀 开发与构建

### 环境要求
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 11+ （**必须使用 pnpm**）
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

# 创建 libgcc 兼容符号链接
cd /path/to/llvm-mingw/x86_64-w64-mingw32/lib/
ln -sf libunwind.a libgcc.a
ln -sf libunwind.a libgcc_eh.a
ln -sf libunwind.a libgcc_s.a

# 构建（需 custom-protocol feature 嵌入前端）
cargo build --release --target x86_64-pc-windows-gnu --features custom-protocol
```

产物为单文件 `zephyr-music.exe`（~20MB），无需 DLL 依赖。

---

## 📖 使用说明

### 首次使用
1. **登录网易云**：点击标题栏「登录」按钮，选择扫码/手机/邮箱登录
2. **浏览歌单**：左侧侧边栏选择「推荐」查看推荐歌单和榜单，或「我的」查看自己的歌单
3. **设置壁纸**：点击标题栏设置图标 → 「背景壁纸」→ 选择本地图片或输入 URL
4. **切换主题**：标题栏 sun/moon 图标，循环 light → dark → auto
5. **个人主页**：侧边栏「我的」→「个人主页」查看用户信息、歌单、最近播放、听歌排行

### 播放音乐
- **歌单播放**：点击歌单查看歌曲列表，单击歌曲播放，或点击「播放全部」
- **搜索播放**：顶部搜索栏输入关键词，回车搜索，支持多类型筛选
- **榜单播放**：推荐页「榜单精选」点击榜单标题进入详情，或直接点击榜单内歌曲
- **本地播放**：搜索页点击「打开本地文件」选择本地音频

### 歌曲操作按钮
在搜索结果、歌单详情的歌曲行上（标题和艺术家之间）：
- ❤️ **喜欢** — 已喜欢时常驻红色，未喜欢时 hover 显示
- 📁 **添加至歌单** — hover 显示，弹出对话框选择歌单
- ⏭️ **下一首播放** — hover 显示，插入当前歌曲后面

### 播放列表
- 三处播放列表均支持**拖拽排序**和**复位键**（定位当前播放歌曲）
- 打开时自动滚动到当前播放歌曲

### 3D 旋转歌词
- 播放界面设置 → 歌词 → 开启「3D 旋转」
- 可调旋转曲率（0-90，90 时呈半圆）
- 旋转模式可单独设置歌词大小和间距
- 滚轮上下滑动 → 歌词弧形旋转（非上下平移）

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
- **启动后自动播放**：开关（默认关闭）

### 播放界面设置（localStorage: `rnp-settings`）
- **外观**：显示模式、配色、主题色
- **封面**：水平/垂直对齐、矩形/圆形、阴影、清晰度
- **背景**：类型（模糊/流体/渐变/纯色/无）、模糊强度、变暗
- **歌词**：字号、行间距、3D 旋转、曲率（0-90）、旋转模式专用字号/间距、对齐、动画曲线、翻译显示
- **字体**：字体族、缩放
- **杂项**：隐藏控件、封面旋转、平滑歌词滚动、启动后自动播放
- **实验性**：GPU 加速、调试日志

### 会话恢复（localStorage: `zephyr-session`）
- 播放队列（只保存歌曲 ID/名称/歌手，不保存 URL）+ 当前索引 + 进度 + 音量
- 重启后自动获取新 URL，无需手动清除歌单

### 网易云 API 配置
`src/api/netease/core.ts` 中的 `API_BASE` 变量：
```ts
export const API_BASE = "https://musicapi.mingqwq.top"; // 你的 api-enhanced 服务地址
```
如需自建 API 服务，参考 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 或 api-enhanced 版本。

---

## 🔒 安全特性
- **CSP 策略**：`script-src 'self'`（移除 unsafe-inline，防 XSS）
- **登录安全**：POST 请求传输密码（不在 URL 参数中）
- **输入清洗**：API 参数去除控制字符
- **HTML5 拖放**：`dragDropEnabled: false` 启用前端拖拽排序

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
