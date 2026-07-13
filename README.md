# Zephyr · 音乐

> 基于 Tauri 2 + Vue 3 的网易云音乐第三方桌面播放器。

---

## ✨ 功能特性

- **网易云音乐集成**：扫码/手机/邮箱登录、歌单同步、每日推荐、听歌排行
- **逐字歌词**：yrc 格式按单词整体擦除动画，支持翻译歌词
- **3D 旋转歌词**：半圆弧形排列，曲率可调，滚轮弧形旋转
- **3D 粒子播放场景**：丝绸粒子背景，音频驱动位移
- **歌词颜色调节**：逐行/逐字已播放、未播放颜色自定义
- **音质选择**：9 个等级（标准 → 超清母带）
- **可自定义榜单**：18 个预设榜单 + 自定义歌单 ID
- **本地播放**：Rust Rodio 后端（mp3/flac/wav/ogg/m4a/aac/opus）
- **全屏播放界面**：背景系统（模糊/流体/渐变/纯色/丝绸粒子）、控件自动隐藏
- **tauri-plugin-store 持久化**：所有数据存储在 exe 同目录，便携使用

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Tauri 2.x |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 状态管理 | Pinia |
| 3D 渲染 | Three.js |
| 后端 | Rust + Rodio + Lofty + Reqwest |
| 持久化 | tauri-plugin-store |
| 交叉编译 | LLVM-MinGW (Clang 22, UCRT) |

---

## 🚀 开发与构建

### 环境要求
- Node.js 18+、pnpm 11+、Rust (stable)
- Tauri 2 前置依赖：参见 [Tauri 官方文档](https://tauri.app/start/prerequisites/)

### 开发模式
```bash
pnpm install
pnpm tauri dev
```

### 构建 Windows 发布版
```bash
pnpm tauri build
```

### 交叉编译 (Linux → Windows x64)
```bash
rustup target add x86_64-pc-windows-gnu
cargo build --release --target x86_64-pc-windows-gnu --features custom-protocol
```

---

## ⚙️ 配置

网易云 API 地址在 `src/api/netease/core.ts` 的 `API_BASE` 变量中修改。

---

## 📝 许可证

GNU Affero General Public License v3.0 (AGPL-3.0)

---

## ⚠️ 免责声明

此项目仅供个人学习，下载后请于 24h 内删除。
