
---
Task ID: fix-62
Agent: Z.ai Code (main)
Task: RNP风格歌词hover；可视化导致封面/歌词上移；隐藏控件无效；封面音乐信息自动隐藏；标题栏中间信息隐藏。

Work Log:
【1. RNP 风格歌词 hover 效果】
- 新增 hoveredLine ref + onLyricEnter/onLyricLeave 处理器
- 模板：lyric-line 加 @mouseenter/@mouseleave，:class 加 hovered
- lineStyle(idx) 中对 hovered 非活动行：
  * scale 乘以 1.12（放大）
  * opacity +0.35（变亮，上限 1）
  * blur -2px（更清晰，下限 0）
- CSS：.lyric-line.hovered:not(.active) color → rgba(255,255,255,0.92)
- transition 加 color 0.18s ease

【2. 可视化不再导致封面/歌词上移】
- 根因：viz-canvas 是 flex item（position:relative; height:26vh），占据 flex 空间
  * np-main(flex:1) 被压缩 26vh → 封面/歌词整体上移
- 修复：viz-canvas 改为 position:absolute; bottom:0（覆盖在底部，不占 flex 空间）
  * 封面/歌词恢复在全视口高度内垂直居中
  * 可视化叠加在底部 26vh，歌词自身的 mask 渐变保证可读性

【3. hidePlayerControls 设置实际生效】
- 根因：.controls-block.hidden 只有 opacity:0 + pointer-events:none
  * 控件不可见但仍占据空间（留空白）
- 修复：.controls-block.hidden 加 max-height:0 + margin-top:-20px
  * 控件完全折叠消失（高度归零，负 margin 抵消 left-pane gap）
  * 鼠标移到顶部时 topbarVisible=true → .hidden 移除 → 控件恢复显示
  * transition 加 max-height + margin 实现平滑收起/展开

【4. 封面下音乐信息不再自动隐藏】
- 移除 song-meta 的 :class="{ hidden: settings.autoHideMiniInfo && !topbarVisible }"
- 封面标题/艺术家始终可见（用户觉得自动隐藏令人困惑）
- 移除 .song-meta.hidden CSS（不再使用）
- autoHideMiniInfo 设置保留（不影响其他逻辑），但 song-meta 不再绑定它

【5. 标题栏中间音乐信息始终可见，仅两侧图标隐藏】
- 根因：整个 topbar 用 opacity:0/.visible 控制，中间标题一起隐藏
- 重构模板：topbar 分三部分
  * .topbar-side.topbar-left（收起图标）
  * .topbar-title（中间歌曲信息，始终可见）
  * .topbar-side.topbar-right（全屏+设置图标）
- CSS：topbar 本身无 opacity 控制
  * .topbar-side 默认 opacity:0，.visible 时 opacity:1
  * min-width:44px 保证两侧占位，标题始终居中
  * transition opacity 0.25s
- 鼠标在顶部 60px 区域 → topbarVisible=true → 两侧图标显示
- 鼠标离开 → topbarVisible=false → 两侧图标淡出，中间标题保留

【构建交付】
- vue-tsc --noEmit 通过
- pnpm build 成功
- 源码已提交并推送到 GitHub (commit 3bb145b)
- 注意：沙箱环境 Rust 工具链已清理，无法重新构建 .exe
  * v1.0.0 Release 上的 zip 仍是上一版（不含本次修复）
  * 用户可在本地用 pnpm tauri build 重新构建

Stage Summary:
- 歌词 hover：RNP 风格放大+变亮+减模糊，平滑过渡
- 可视化：absolute 覆盖底部，封面/歌词全高居中不上移
- 隐藏控件：max-height:0 完全折叠，不再留空白
- 封面信息：始终可见，不自动隐藏
- 标题栏：中间歌曲信息常驻，仅两侧图标随鼠标淡入淡出
- 源码已推送 GitHub，.exe 需本地重新构建
