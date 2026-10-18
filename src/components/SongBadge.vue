<script setup lang="ts">
/**
 * SongBadge — 歌曲标识组件
 *
 * 根据 Song 的 fee / mark / 音质字段渲染对应的标识标签：
 *   - VIP (fee=1)
 *   - 购买 (fee=4)
 *   - SQ 无损 (hasSq)
 *   - Hi-Res (hasHires)
 *   - 杜比 (mark & 262144)
 *   - 纯音乐 (mark & 131072)
 *   - E 脏标 (mark & 1048576)
 *
 * 已去除：试听 (fee=8)
 *
 * 限制：最多显示 2 个标识，避免标题区域被标识挤占过多空间。
 * 优先级：收费标识 > 音质标识 > 脏标 > 纯音乐
 *
 * Props:
 *   song: Song 对象
 *   size: 'sm' | 'md' 标识大小，默认 sm（列表行内用）
 *   vipOnly: boolean 仅显示 VIP 标识（用于播放栏等场景），默认 false
 */
import type { Song } from "@/types";

withDefaults(defineProps<{
  song: Song;
  size?: "sm" | "md";
  vipOnly?: boolean;
}>(), {
  size: "sm",
  vipOnly: false,
});

/** mark 位标记常量 */
const MARK_PURE_MUSIC = 131072;
const MARK_DOLBY = 262144;
const MARK_EXPLICIT = 1048576;

interface BadgeItem {
  label: string;
  cls: string;
  /** 优先级：数字越小越优先 */
  priority: number;
}

/** 计算当前歌曲应显示的标识列表（最多2个） */
function getBadges(song: Song): BadgeItem[] {
  const badges: BadgeItem[] = [];
  const mark = song.mark ?? 0;

  // 收费类型（最高优先级）
  if (song.fee === 1) {
    badges.push({ label: "VIP", cls: "badge-vip", priority: 1 });
  } else if (song.fee === 4) {
    badges.push({ label: "购买", cls: "badge-buy", priority: 1 });
  }
  // 试听 (fee=8) 已去除

  // 音质标识
  if (song.hasHires) {
    badges.push({ label: "Hi-Res", cls: "badge-hires", priority: 2 });
  } else if (song.hasSq) {
    badges.push({ label: "SQ", cls: "badge-sq", priority: 2 });
  }

  // 杜比全景声
  if ((mark & MARK_DOLBY) === MARK_DOLBY) {
    badges.push({ label: "Atmos", cls: "badge-dolby", priority: 3 });
  }

  // 脏标
  if ((mark & MARK_EXPLICIT) === MARK_EXPLICIT) {
    badges.push({ label: "E", cls: "badge-explicit", priority: 4 });
  }

  // 纯音乐
  if ((mark & MARK_PURE_MUSIC) === MARK_PURE_MUSIC) {
    badges.push({ label: "纯", cls: "badge-pure", priority: 5 });
  }

  // 按优先级排序，最多保留 2 个
  badges.sort((a, b) => a.priority - b.priority);
  return badges.slice(0, 2);
}
</script>

<template>
  <span v-if="vipOnly ? song.fee === 1 : getBadges(song).length" class="song-badge-group" :class="[`badge-${size}`]">
    <template v-if="vipOnly">
      <span class="song-badge badge-vip">VIP</span>
    </template>
    <template v-else>
      <span
        v-for="(badge, idx) in getBadges(song)"
        :key="idx"
        class="song-badge"
        :class="badge.cls"
      >{{ badge.label }}</span>
    </template>
  </span>
</template>

<style scoped>
.song-badge-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  white-space: nowrap;
}

/* 尺寸变体 */
.badge-sm .song-badge {
  font-size: 9px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 2px;
  letter-spacing: 0;
  font-weight: 700;
}
.badge-md .song-badge {
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 3px;
  letter-spacing: 0;
  font-weight: 700;
}

/* 标识基础样式 */
.song-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-style: normal;
  border: none;
  opacity: 0.9;
}

/* VIP 标识 — 金色 */
.badge-vip {
  color: #d4a843;
  background: rgba(212, 168, 67, 0.15);
}

/* 购买标识 — 红色 */
.badge-buy {
  color: #e85d5d;
  background: rgba(232, 93, 93, 0.15);
}

/* SQ 无损标识 — 青色 */
.badge-sq {
  color: #3db8c1;
  background: rgba(61, 184, 193, 0.15);
}

/* Hi-Res 标识 — 紫色 */
.badge-hires {
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.15);
}

/* 杜比全景声标识 — 蓝色 */
.badge-dolby {
  color: #5b9cf6;
  background: rgba(91, 156, 246, 0.15);
}

/* 脏标 E — 灰色 */
.badge-explicit {
  color: #9ca3af;
  background: rgba(156, 163, 175, 0.15);
}

/* 纯音乐标识 — 绿色 */
.badge-pure {
  color: #6ee7b7;
  background: rgba(110, 231, 183, 0.15);
}
</style>
