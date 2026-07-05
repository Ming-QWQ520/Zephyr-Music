<script setup lang="ts">
/**
 * 歌曲评论视图（在主内容区域内显示，不覆盖侧边栏和播放栏）
 */
import { ref, computed, watch, onMounted } from "vue";
import { usePlayerStore } from "@/stores/player";
import { commentNew, commentAction, type NewComment } from "@/api/netease";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

const songComments = ref<NewComment[]>([]);
const commentCount = ref(0);
const commentSortType = ref<1 | 2 | 3>(1); // 默认按推荐排序
const commentLoading = ref(false);
const commentPageNo = ref(1);
const commentCursor = ref<number | undefined>(undefined);
const commentHasMore = ref(false);
const SORT_LABELS: Record<1 | 2 | 3, string> = { 1: "推荐", 2: "热度", 3: "时间" };

// 发送/回复/删除
const commentInput = ref("");
const replyTo = ref<NewComment | null>(null);
const sendingComment = ref(false);
/** 已点赞评论集合（本地维护） */
const likedComments = ref<Set<number>>(new Set());

const currentSong = computed(() => store.currentSong);

/** 格式化时间为日期 */
function formatDate(time: number): string {
  if (!time) return "";
  const d = new Date(time);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

/** 格式化评论数量 */
function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

async function loadComments(reset = false) {
  const song = currentSong.value;
  if (!song || !song.neteaseId) return;
  if (commentLoading.value) return;
  if (reset) {
    songComments.value = [];
    commentPageNo.value = 1;
    commentCursor.value = undefined;
    commentCount.value = 0;
  }
  commentLoading.value = true;
  try {
    const res = await commentNew(song.neteaseId, 0, commentSortType.value, commentPageNo.value, 20, commentCursor.value);
    if (reset) songComments.value = res.comments || [];
    else songComments.value.push(...(res.comments || []));
    commentCount.value = res.totalCount || 0;
    commentHasMore.value = !!res.hasMore;
    commentCursor.value = res.cursor;
    if (commentHasMore.value) commentPageNo.value += 1;
  } catch (e) {
    log.warn("comments", "load comments failed", { error: String(e) });
  }
  commentLoading.value = false;
}

async function switchCommentSort(sort: 1 | 2 | 3) {
  if (commentSortType.value === sort) return;
  commentSortType.value = sort;
  await loadComments(true);
}

function onListScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50 && commentHasMore.value && !commentLoading.value) {
    loadComments(false);
  }
}

async function sendComment() {
  const song = currentSong.value;
  if (!song || !song.neteaseId || !commentInput.value.trim()) return;
  sendingComment.value = true;
  try {
    const t = replyTo.value ? 2 : 1;
    const commentId = replyTo.value?.commentId;
    const res = await commentAction(t, 0, song.neteaseId, commentInput.value.trim(), commentId);
    if (res.code === 200) {
      commentInput.value = "";
      replyTo.value = null;
      await loadComments(true);
    } else {
      let errMsg = `发送失败 (${res.code})`;
      if (res.code === 301 || res.code === 302) errMsg = "需要登录";
      else if (res.code === 250) errMsg = "风控限制：请在网易云 App 中评论";
      else if (res.msg) errMsg = res.msg;
      else if (res.message) errMsg = res.message;
      alert(errMsg);
    }
  } catch (e) {
    log.warn("comments", "send comment failed", { error: String(e) });
    alert("发送评论失败: " + String(e));
  }
  sendingComment.value = false;
}

function setReplyTo(comment: NewComment) {
  replyTo.value = comment;
}

function cancelReply() {
  replyTo.value = null;
}

async function deleteComment(comment: NewComment) {
  const song = currentSong.value;
  if (!song || !song.neteaseId) return;
  try {
    const res = await commentAction(0, 0, song.neteaseId, undefined, comment.commentId);
    if (res.code === 200) {
      songComments.value = songComments.value.filter(c => c.commentId !== comment.commentId);
      commentCount.value = Math.max(0, commentCount.value - 1);
    }
  } catch (e) {
    log.warn("comments", "delete comment failed", { error: String(e) });
  }
}

/** 切换点赞状态（本地维护，仅 UI 效果） */
function toggleLike(comment: NewComment) {
  const id = comment.commentId;
  if (likedComments.value.has(id)) {
    likedComments.value.delete(id);
    comment.likedCount = Math.max(0, comment.likedCount - 1);
  } else {
    likedComments.value.add(id);
    comment.likedCount = (comment.likedCount || 0) + 1;
  }
  likedComments.value = new Set(likedComments.value);
}

function isLiked(commentId: number): boolean {
  return likedComments.value.has(commentId);
}

function goBack() {
  store.goBackView();
}

onMounted(() => {
  loadComments(true);
});
</script>

<template>
  <section class="comments-view">
    <header class="cv-head">
      <button class="cv-back" @click="goBack" title="返回">
        <Icon name="chevronLeft" :size="22" />
      </button>
      <div class="cv-title-block">
        <h1>歌曲评论</h1>
        <p class="cv-sub" v-if="commentCount">共 {{ formatCount(commentCount) }} 条评论</p>
      </div>
    </header>

    <!-- 当前歌曲信息 -->
    <div class="cv-song-info" v-if="currentSong">
      <div class="cv-song-cover">
        <img v-if="currentSong.pic" :src="currentSong.pic" :alt="currentSong.name" referrerpolicy="no-referrer" />
        <Icon v-else name="music" :size="20" />
      </div>
      <div class="cv-song-meta">
        <div class="cv-song-name truncate">{{ currentSong.name }}</div>
        <div class="cv-song-artist truncate">{{ currentSong.artist }}</div>
      </div>
    </div>

    <!-- 排序方式 -->
    <div class="cv-sort-bar">
      <button v-for="s in ([1,2,3] as const)" :key="s"
        class="cv-sort-btn" :class="{ active: commentSortType === s }"
        @click="switchCommentSort(s)">{{ SORT_LABELS[s] }}</button>
    </div>

    <!-- 评论列表 -->
    <div class="cv-list nice-scroll" @scroll="onListScroll">
      <div v-if="commentLoading && !songComments.length" class="cv-loading">
        <div class="spinner" />
      </div>
      <div v-else-if="!songComments.length" class="cv-empty">
        <Icon name="list" :size="42" />
        <p>暂无评论</p>
      </div>
      <div v-for="c in songComments" :key="c.commentId" class="cv-item">
        <img v-if="c.user.avatarUrl" :src="c.user.avatarUrl + '?param=50x50'" class="cv-avatar" referrerpolicy="no-referrer" loading="lazy" />
        <div class="cv-body">
          <div class="cv-header">
            <span class="cv-user">{{ c.user.nickname }}</span>
            <span v-if="c.ipLocation" class="cv-loc">{{ c.ipLocation }}</span>
          </div>
          <!-- 所在地下方：点赞按钮 -->
          <div class="cv-like-row">
            <button class="cv-like-btn" :class="{ liked: isLiked(c.commentId) }" @click="toggleLike(c)">
              <img v-if="isLiked(c.commentId)" src="/icons/like.svg" alt="liked" class="cv-action-icon" />
              <img v-else src="/icons/not_like.svg" alt="not liked" class="cv-action-icon" />
              <span v-if="c.likedCount > 0">{{ c.likedCount }}</span>
            </button>
          </div>
          <div class="cv-content">{{ c.content }}</div>
          <!-- 回复 + 删除 -->
          <div class="cv-actions">
            <button class="cv-reply-btn" @click="setReplyTo(c)">回复</button>
            <button class="cv-delete-btn" @click="deleteComment(c)">删除</button>
          </div>
          <!-- 发送日期 -->
          <div class="cv-date">{{ formatDate(c.time) }}</div>
        </div>
      </div>
      <div v-if="commentLoading && songComments.length" class="cv-loading-more">加载中...</div>
    </div>

    <!-- 发送评论输入框 -->
    <div class="cv-input-area">
      <div v-if="replyTo" class="cv-reply-hint">
        <span>回复 @{{ replyTo.user.nickname }}</span>
        <button class="cv-cancel-reply" @click="cancelReply">×</button>
      </div>
      <div class="cv-input-row">
        <input
          v-model="commentInput"
          class="cv-input"
          :placeholder="replyTo ? `回复 @${replyTo.user.nickname}` : '发送评论...'"
          @keydown.enter="sendComment"
          :disabled="sendingComment"
        />
        <button class="cv-send-btn" :disabled="!commentInput.trim() || sendingComment" @click="sendComment">
          {{ sendingComment ? "发送中" : "发送" }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.comments-view {
  display: flex; flex-direction: column;
  height: 100%; padding: 0; gap: 0;
}
.cv-head {
  display: flex; align-items: center; gap: 12px;
  padding: 20px 24px 16px; flex-shrink: 0;
}
.cv-back {
  width: 40px; height: 40px; border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); transition: color 0.15s, background 0.15s; flex-shrink: 0;
}
.cv-back:hover { color: var(--text); background: var(--bg-hover); }
.cv-title-block h1 { margin: 0; font-size: 24px; font-weight: 700; }
.cv-sub { margin: 4px 0 0; font-size: 12px; color: var(--text-tertiary); }

.cv-song-info {
  display: flex; align-items: center; gap: 12px;
  padding: 0 24px 16px; flex-shrink: 0;
}
.cv-song-cover {
  width: 48px; height: 48px; border-radius: 8px; flex-shrink: 0;
  background: var(--bg-elev-3); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
}
.cv-song-cover img { width: 100%; height: 100%; object-fit: cover; }
.cv-song-meta { flex: 1; min-width: 0; }
.cv-song-name { font-size: 14px; color: var(--text); font-weight: 600; }
.cv-song-artist { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }

.cv-sort-bar { display: flex; gap: 4px; padding: 0 24px 12px; flex-shrink: 0; }
.cv-sort-btn {
  padding: 6px 16px; border-radius: 14px; font-size: 12px;
  color: var(--text-tertiary); background: var(--bg-elev-1);
  transition: all 0.15s;
}
.cv-sort-btn:hover { color: var(--text); }
.cv-sort-btn.active { background: var(--accent); color: #fff; font-weight: 600; }

.cv-list { flex: 1; overflow-y: auto; padding: 0 24px 16px; }
.cv-loading { display: flex; align-items: center; justify-content: center; padding: 48px; }
.spinner { width: 28px; height: 28px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.cv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; color: var(--text-tertiary); font-size: 14px; }
.cv-item { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.cv-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; object-fit: cover; }
.cv-body { flex: 1; min-width: 0; }
.cv-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cv-user { font-size: 13px; font-weight: 600; color: var(--text); }
.cv-loc { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }
.cv-content { font-size: 13px; color: var(--text-secondary); line-height: 1.6; word-break: break-word; }
.cv-like-row { margin-top: 4px; margin-bottom: 4px; }
.cv-actions { display: flex; align-items: center; gap: 14px; margin-top: 8px; }
.cv-like-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-tertiary); transition: color 0.15s;
}
.cv-like-btn:hover { color: var(--accent); }
.cv-like-btn.liked { color: var(--accent); }
.cv-action-icon { width: 14px; height: 14px; pointer-events: none; }
.cv-reply-btn, .cv-delete-btn { font-size: 11px; color: var(--text-tertiary); transition: color 0.15s; }
.cv-reply-btn:hover { color: var(--accent); }
.cv-delete-btn:hover { color: #ff4d4f; }
.cv-date { font-size: 11px; color: var(--text-tertiary); margin-top: 6px; }
.cv-loading-more { padding: 10px; text-align: center; font-size: 11px; color: var(--text-tertiary); }

.cv-input-area { border-top: 1px solid var(--border); padding: 12px 24px; flex-shrink: 0; }
.cv-reply-hint {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; margin-bottom: 8px; border-radius: 6px;
  background: var(--bg-elev-1); font-size: 12px; color: var(--text-secondary);
}
.cv-cancel-reply { width: 20px; height: 20px; border-radius: 50%; color: var(--text-tertiary); font-size: 16px; line-height: 1; }
.cv-cancel-reply:hover { color: var(--text); background: var(--bg-hover); }
.cv-input-row { display: flex; gap: 8px; }
.cv-input {
  flex: 1; height: 38px; padding: 0 12px; border-radius: 8px;
  background: var(--bg-elev-1); border: 1px solid var(--border);
  color: var(--text); font-size: 13px; transition: border-color 0.15s;
}
.cv-input:focus { outline: none; border-color: var(--accent); }
.cv-input::placeholder { color: var(--text-tertiary); }
.cv-send-btn {
  padding: 0 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: var(--accent); color: #fff; transition: opacity 0.15s;
}
.cv-send-btn:hover:not(:disabled) { opacity: 0.9; }
.cv-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
