<script setup lang="ts">
/**
 * 歌曲评论视图（在主内容区域内显示，不覆盖侧边栏和播放栏）
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  _cachedUser,
  commentAction,
  commentFloor,
  commentLike,
  commentNew,
  describeCommentError,
  getCookie,
  isCommentRiskControlled,
  type NewComment,
} from "@/api/netease";
import { log } from "@/composables/logger";
import { useToast } from "@/composables/useToast";
import Icon from "@/components/Icon.vue";

const emit = defineEmits<{ (event: "request-login"): void }>();
const store = usePlayerStore();
const toast = useToast();

const songComments = ref<NewComment[]>([]);
const commentCount = ref(0);
const commentSortType = ref<1 | 2 | 3>(1);
const commentLoading = ref(false);
const commentLoadError = ref("");
const commentPageNo = ref(1);
const commentCursor = ref<number | undefined>(undefined);
const commentHasMore = ref(false);
const SORT_LABELS: Record<1 | 2 | 3, string> = { 1: "推荐", 2: "热度", 3: "时间" };
let commentsRequestId = 0;

const commentInput = ref("");
const replyTo = ref<NewComment | null>(null);
const replyFloorParent = ref<NewComment | null>(null);
const sendingComment = ref(false);
const likingIds = ref<Set<number>>(new Set());
const deletingIds = ref<Set<number>>(new Set());
const pendingDeleteId = ref<number | null>(null);
const riskControlMessage = ref("");
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null;

interface FloorState {
  open: boolean;
  loaded: boolean;
  loading: boolean;
  comments: NewComment[];
  totalCount: number;
  hasMore: boolean;
  time?: number;
  error: string;
}
const floorStates = reactive(new Map<number, FloorState>());

const MAX_COMMENT_LEN = 140;
const currentSong = computed(() => store.currentSong);
/** Cookie 与共享用户缓存同时存在才视为有效登录；登录/退出后会自动更新。 */
const isLoggedIn = computed(() => !!getCookie() && !!_cachedUser.value);

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

function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

function avatarUrl(url: string, size = 50): string {
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}param=${size}x${size}`;
}

function seedFloorState(comment: NewComment) {
  if (floorStates.has(comment.commentId)) return;
  floorStates.set(comment.commentId, {
    open: false,
    loaded: false,
    loading: false,
    comments: [...comment.beReplied],
    totalCount: Math.max(comment.replyCount, comment.beReplied.length),
    hasMore: comment.replyCount > comment.beReplied.length,
    time: undefined,
    error: "",
  });
}

function floorState(commentId: number): FloorState | undefined {
  return floorStates.get(commentId);
}

function mergeUniqueComments(current: NewComment[], incoming: NewComment[]): NewComment[] {
  const ids = new Set(current.map(comment => comment.commentId));
  return [...current, ...incoming.filter(comment => !ids.has(comment.commentId))];
}

async function loadComments(reset = false) {
  const song = currentSong.value;
  if (!song?.neteaseId) return;
  if (!reset && (commentLoading.value || !commentHasMore.value)) return;

  const requestId = reset ? ++commentsRequestId : commentsRequestId;
  const resourceId = song.neteaseId;
  if (reset) {
    songComments.value = [];
    floorStates.clear();
    commentPageNo.value = 1;
    commentCursor.value = undefined;
    commentCount.value = 0;
    commentHasMore.value = true;
  }
  commentLoading.value = true;
  commentLoadError.value = "";
  try {
    const res = await commentNew(
      resourceId,
      0,
      commentSortType.value,
      commentPageNo.value,
      20,
      commentCursor.value,
    );
    if (requestId !== commentsRequestId || currentSong.value?.neteaseId !== resourceId) return;
    if (res.code !== undefined && res.code !== 200) {
      throw new Error(`评论接口返回 ${res.code}`);
    }
    const incoming = res.comments || [];
    songComments.value = reset ? incoming : mergeUniqueComments(songComments.value, incoming);
    for (const comment of songComments.value) seedFloorState(comment);
    commentCount.value = res.totalCount || 0;
    commentHasMore.value = !!res.hasMore;
    commentCursor.value = res.cursor ?? incoming[incoming.length - 1]?.time;
    if (commentHasMore.value) commentPageNo.value += 1;
  } catch (error) {
    if (requestId !== commentsRequestId) return;
    commentLoadError.value = "评论加载失败，请检查网络后重试";
    log.warn("comments", "load comments failed", { error: String(error) });
  } finally {
    if (requestId === commentsRequestId) commentLoading.value = false;
  }
}

async function switchCommentSort(sort: 1 | 2 | 3) {
  if (commentSortType.value === sort) return;
  commentSortType.value = sort;
  await loadComments(true);
}

function onListScroll(event: Event) {
  const element = event.target as HTMLElement;
  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) loadComments(false);
}

async function loadFloorComments(parent: NewComment, reset = false) {
  const song = currentSong.value;
  if (!song?.neteaseId) return;
  seedFloorState(parent);
  const state = floorStates.get(parent.commentId)!;
  if (state.loading || (!reset && state.loaded && !state.hasMore)) return;
  if (reset) {
    state.comments = [];
    state.time = undefined;
    state.hasMore = true;
  }
  state.loading = true;
  state.error = "";
  try {
    const res = await commentFloor(song.neteaseId, parent.commentId, 0, 20, state.time);
    if (res.code !== undefined && res.code !== 200) throw new Error(`楼层接口返回 ${res.code}`);
    state.comments = reset ? res.comments : mergeUniqueComments(state.comments, res.comments);
    state.totalCount = Math.max(res.totalCount, state.comments.length);
    state.hasMore = res.hasMore;
    state.time = res.time ?? state.comments[state.comments.length - 1]?.time;
    state.loaded = true;
    parent.replyCount = state.totalCount;
  } catch (error) {
    state.error = "回复加载失败，点击重试";
    log.warn("comments", "load floor comments failed", {
      parentCommentId: parent.commentId,
      error: String(error),
    });
  } finally {
    state.loading = false;
  }
}

function toggleFloor(parent: NewComment) {
  seedFloorState(parent);
  const state = floorStates.get(parent.commentId)!;
  state.open = !state.open;
  if (state.open && !state.loaded) loadFloorComments(parent, true);
}

function handleWriteFailure(title: string, response: {
  code: number;
  msg?: string;
  message?: string;
  dialog?: { title?: string; subtitle?: string };
}) {
  const message = describeCommentError(response);
  if (isCommentRiskControlled(response.code)) riskControlMessage.value = message;
  toast.error(title, message, 5000);
}

async function sendComment() {
  const song = currentSong.value;
  const text = commentInput.value.trim();
  if (!song?.neteaseId || !text) return;
  if (!isLoggedIn.value) {
    toast.warning("请先登录", "登录后即可发表评论");
    return;
  }
  if (text.length > MAX_COMMENT_LEN) {
    toast.warning("评论过长", `最多 ${MAX_COMMENT_LEN} 字`);
    return;
  }
  if (sendingComment.value) return;

  const target = replyTo.value;
  const floorParent = replyFloorParent.value || target;
  sendingComment.value = true;
  try {
    const response = await commentAction(
      target ? 2 : 1,
      0,
      song.neteaseId,
      text,
      target?.commentId,
    );
    if (response.code === 200) {
      commentInput.value = "";
      replyTo.value = null;
      replyFloorParent.value = null;
      riskControlMessage.value = "";
      if (target && floorParent) {
        seedFloorState(floorParent);
        const state = floorStates.get(floorParent.commentId)!;
        state.open = true;
        await loadFloorComments(floorParent, true);
        toast.success("回复成功", `已回复 @${target.user.nickname}`);
      } else if (response.comment) {
        songComments.value.unshift(response.comment);
        seedFloorState(response.comment);
        commentCount.value += 1;
        toast.success("评论成功");
      } else {
        toast.success("评论成功");
        await loadComments(true);
      }
    } else {
      handleWriteFailure(target ? "回复失败" : "评论失败", response);
      log.warn("comments", "send comment failed", {
        code: response.code,
        msg: response.msg,
        dialog: response.dialog?.subtitle,
      });
    }
  } catch (error) {
    log.warn("comments", "send comment error", { error: String(error) });
    toast.error(target ? "回复失败" : "评论失败", "网络异常，请稍后再试");
  } finally {
    sendingComment.value = false;
  }
}

function onCommentKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.key !== "Enter") return;
  event.preventDefault();
  sendComment();
}

function setReplyTo(comment: NewComment, floorParent?: NewComment) {
  replyTo.value = comment;
  replyFloorParent.value = floorParent || comment;
}

function cancelReply() {
  replyTo.value = null;
  replyFloorParent.value = null;
}

function requestDelete(comment: NewComment, floorParent?: NewComment) {
  if (deletingIds.value.has(comment.commentId)) return;
  if (pendingDeleteId.value !== comment.commentId) {
    pendingDeleteId.value = comment.commentId;
    if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
    deleteConfirmTimer = setTimeout(() => { pendingDeleteId.value = null; }, 4000);
    toast.warning("确认删除", "请在 4 秒内再次点击删除");
    return;
  }
  pendingDeleteId.value = null;
  deleteComment(comment, floorParent);
}

async function deleteComment(comment: NewComment, floorParent?: NewComment) {
  const song = currentSong.value;
  if (!song?.neteaseId) return;
  deletingIds.value.add(comment.commentId);
  try {
    const response = await commentAction(0, 0, song.neteaseId, undefined, comment.commentId);
    if (response.code === 200) {
      if (floorParent) {
        const state = floorStates.get(floorParent.commentId);
        if (state) {
          state.comments = state.comments.filter(item => item.commentId !== comment.commentId);
          state.totalCount = Math.max(0, state.totalCount - 1);
          floorParent.replyCount = state.totalCount;
        }
      } else {
        songComments.value = songComments.value.filter(item => item.commentId !== comment.commentId);
        floorStates.delete(comment.commentId);
        commentCount.value = Math.max(0, commentCount.value - 1);
      }
      toast.success("已删除评论");
    } else {
      handleWriteFailure("删除失败", response);
    }
  } catch (error) {
    log.warn("comments", "delete comment failed", { error: String(error) });
    toast.error("删除失败", "网络异常，请稍后再试");
  } finally {
    deletingIds.value.delete(comment.commentId);
  }
}

/** 点赞态来自 /comment/new 与 /comment/floor 的 liked 字段；操作时乐观更新，失败自动回滚。 */
async function toggleLike(comment: NewComment) {
  const song = currentSong.value;
  if (!song?.neteaseId) return;
  if (!isLoggedIn.value) {
    toast.warning("请先登录", "登录后即可点赞评论");
    return;
  }
  const commentId = comment.commentId;
  if (likingIds.value.has(commentId)) return;
  const wasLiked = comment.liked;
  comment.liked = !wasLiked;
  comment.likedCount = Math.max(0, comment.likedCount + (wasLiked ? -1 : 1));
  likingIds.value.add(commentId);
  try {
    const response = await commentLike(song.neteaseId, commentId, wasLiked ? 0 : 1, 0);
    if (response.code !== 200) {
      comment.liked = wasLiked;
      comment.likedCount = Math.max(0, comment.likedCount + (wasLiked ? 1 : -1));
      handleWriteFailure(wasLiked ? "取消点赞失败" : "点赞失败", response);
      log.warn("comments", "like failed", { code: response.code });
    } else {
      riskControlMessage.value = "";
    }
  } catch (error) {
    comment.liked = wasLiked;
    comment.likedCount = Math.max(0, comment.likedCount + (wasLiked ? 1 : -1));
    log.warn("comments", "like error", { error: String(error) });
    toast.error("点赞失败", "网络异常，请稍后再试");
  } finally {
    likingIds.value.delete(commentId);
  }
}

function goBack() {
  store.goBackView();
}

watch(
  () => currentSong.value?.neteaseId,
  (songId) => {
    commentsRequestId += 1;
    floorStates.clear();
    commentInput.value = "";
    cancelReply();
    riskControlMessage.value = "";
    if (songId) loadComments(true);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  commentsRequestId += 1;
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
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
      <div v-else-if="commentLoadError && !songComments.length" class="cv-empty cv-error">
        <Icon name="info" :size="34" />
        <p>{{ commentLoadError }}</p>
        <button type="button" @click="loadComments(true)">重新加载</button>
      </div>
      <div v-else-if="!songComments.length" class="cv-empty">
        <Icon name="list" :size="42" />
        <p>暂无评论</p>
      </div>
      <div v-for="c in songComments" :key="c.commentId" class="cv-item">
        <img
          v-if="c.user.avatarUrl"
          :src="avatarUrl(c.user.avatarUrl)"
          class="cv-avatar"
          referrerpolicy="no-referrer"
          loading="lazy"
        />
        <div class="cv-body">
          <div class="cv-header">
            <span class="cv-user">{{ c.user.nickname }}</span>
            <span v-if="c.ipLocation" class="cv-loc">{{ c.ipLocation }}</span>
          </div>
          <div class="cv-content">{{ c.content }}</div>

          <!-- API 随主评论返回的楼层预览 -->
          <button
            v-if="c.beReplied.length && !floorState(c.commentId)?.open"
            type="button"
            class="cv-reply-preview"
            @click="toggleFloor(c)"
          >
            <strong>@{{ c.beReplied[0].user.nickname }}</strong>
            <span>{{ c.beReplied[0].content }}</span>
          </button>

          <div class="cv-actions">
            <span class="cv-date">{{ formatDate(c.time) }}</span>
            <button
              class="cv-like-btn"
              :class="{ liked: c.liked }"
              :disabled="likingIds.has(c.commentId)"
              :title="c.liked ? '取消点赞' : '点赞'"
              @click="toggleLike(c)"
            >
              <img v-if="c.liked" src="/icons/like.svg" alt="" class="cv-action-icon" />
              <img v-else src="/icons/not_like.svg" alt="" class="cv-action-icon" />
              <span>{{ c.likedCount > 0 ? formatCount(c.likedCount) : "赞" }}</span>
            </button>
            <button class="cv-reply-btn" @click="setReplyTo(c)">回复</button>
            <button
              v-if="c.replyCount > 0 || c.beReplied.length"
              class="cv-floor-toggle"
              @click="toggleFloor(c)"
            >
              {{ floorState(c.commentId)?.open ? "收起回复" : `查看 ${formatCount(Math.max(c.replyCount, c.beReplied.length))} 条回复` }}
            </button>
            <button
              v-if="c.owner"
              class="cv-delete-btn"
              :class="{ confirming: pendingDeleteId === c.commentId }"
              :disabled="deletingIds.has(c.commentId)"
              @click="requestDelete(c)"
            >
              {{ deletingIds.has(c.commentId) ? "删除中" : pendingDeleteId === c.commentId ? "确认删除" : "删除" }}
            </button>
          </div>

          <!-- 楼层回复 -->
          <div v-if="floorState(c.commentId)?.open" class="cv-floor">
            <div v-if="floorState(c.commentId)?.loading && !floorState(c.commentId)?.comments.length" class="cv-floor-status">
              加载回复中...
            </div>
            <button
              v-else-if="floorState(c.commentId)?.error"
              type="button"
              class="cv-floor-status error"
              @click="loadFloorComments(c, true)"
            >
              {{ floorState(c.commentId)?.error }}
            </button>
            <div
              v-for="reply in (floorState(c.commentId)?.comments || [])"
              :key="reply.commentId"
              class="cv-floor-item"
            >
              <img
                v-if="reply.user.avatarUrl"
                :src="avatarUrl(reply.user.avatarUrl, 36)"
                class="cv-floor-avatar"
                referrerpolicy="no-referrer"
                loading="lazy"
              />
              <div class="cv-floor-body">
                <div class="cv-floor-head">
                  <strong>{{ reply.user.nickname }}</strong>
                  <span v-if="reply.ipLocation">{{ reply.ipLocation }}</span>
                </div>
                <p>{{ reply.content }}</p>
                <div class="cv-floor-actions">
                  <span>{{ formatDate(reply.time) }}</span>
                  <button
                    :class="{ liked: reply.liked }"
                    :disabled="likingIds.has(reply.commentId)"
                    @click="toggleLike(reply)"
                  >
                    {{ reply.liked ? "已赞" : "赞" }}<template v-if="reply.likedCount"> {{ formatCount(reply.likedCount) }}</template>
                  </button>
                  <button @click="setReplyTo(reply, c)">回复</button>
                  <button
                    v-if="reply.owner"
                    class="cv-delete-btn"
                    :class="{ confirming: pendingDeleteId === reply.commentId }"
                    :disabled="deletingIds.has(reply.commentId)"
                    @click="requestDelete(reply, c)"
                  >
                    {{ deletingIds.has(reply.commentId) ? "删除中" : pendingDeleteId === reply.commentId ? "确认删除" : "删除" }}
                  </button>
                </div>
              </div>
            </div>
            <button
              v-if="floorState(c.commentId)?.loaded && floorState(c.commentId)?.hasMore"
              type="button"
              class="cv-floor-more"
              :disabled="floorState(c.commentId)?.loading"
              @click="loadFloorComments(c)"
            >
              {{ floorState(c.commentId)?.loading ? "加载中..." : "加载更多回复" }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="commentLoading && songComments.length" class="cv-loading-more">加载中...</div>
      <button
        v-else-if="commentLoadError && songComments.length"
        type="button"
        class="cv-loading-more cv-retry-more"
        @click="loadComments(false)"
      >
        加载失败，点击重试
      </button>
    </div>

    <!-- 发送评论输入框 -->
    <div class="cv-input-area">
      <!-- 未登录守卫：提示登录，隐藏输入框 -->
      <div v-if="!isLoggedIn" class="cv-login-hint">
        <Icon name="info" :size="14" />
        <span>登录后即可评论与点赞</span>
        <button type="button" @click="emit('request-login')">立即登录</button>
      </div>
      <template v-else>
        <div v-if="riskControlMessage" class="cv-risk-hint" role="alert">
          <Icon name="info" :size="14" />
          <span>{{ riskControlMessage }}</span>
          <button type="button" title="关闭提示" @click="riskControlMessage = ''">×</button>
        </div>
        <div v-if="replyTo" class="cv-reply-hint">
          <span>回复 @{{ replyTo.user.nickname }}</span>
          <button class="cv-cancel-reply" @click="cancelReply">×</button>
        </div>
        <div class="cv-input-row">
          <input
            v-model="commentInput"
            class="cv-input"
            :maxlength="MAX_COMMENT_LEN"
            :placeholder="replyTo ? `回复 @${replyTo.user.nickname}` : '你有什么故事要分享呢...'"
            :disabled="sendingComment"
            @keydown="onCommentKeydown"
          />
          <span class="cv-char-count" :class="{ warn: commentInput.length >= MAX_COMMENT_LEN }">{{ commentInput.length }}/{{ MAX_COMMENT_LEN }}</span>
          <button class="cv-send-btn" :disabled="!commentInput.trim() || sendingComment" @click="sendComment">
            {{ sendingComment ? "发送中" : "发送" }}
          </button>
        </div>
      </template>
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
.cv-error > button { padding: 7px 14px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 12px; }
.cv-item { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.cv-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; object-fit: cover; }
.cv-body { flex: 1; min-width: 0; }
.cv-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cv-user { font-size: 13px; font-weight: 600; color: var(--text); }
.cv-loc { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }
.cv-content { font-size: 13px; color: var(--text-secondary); line-height: 1.6; word-break: break-word; }
.cv-reply-preview {
  display: flex; gap: 6px; width: 100%; margin-top: 8px; padding: 8px 10px;
  border-radius: 8px; background: var(--bg-elev-1); color: var(--text-tertiary);
  font-size: 11px; line-height: 1.5; text-align: left;
}
.cv-reply-preview strong { flex-shrink: 0; color: var(--accent); }
.cv-reply-preview span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-actions { display: flex; align-items: center; gap: 14px; margin-top: 8px; }
.cv-like-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-tertiary); transition: color 0.15s;
}
.cv-like-btn:hover { color: var(--accent); }
.cv-like-btn.liked { color: var(--accent); }
.cv-like-btn:disabled { opacity: 0.55; cursor: wait; }
.cv-action-icon { width: 14px; height: 14px; pointer-events: none; }
.cv-reply-btn, .cv-delete-btn, .cv-floor-toggle { font-size: 11px; color: var(--text-tertiary); transition: color 0.15s; }
.cv-reply-btn:hover { color: var(--accent); }
.cv-floor-toggle { color: var(--accent); }
.cv-delete-btn:hover { color: #ff4d4f; }
.cv-delete-btn.confirming { color: #ff4d4f; font-weight: 600; }
.cv-delete-btn:disabled { opacity: 0.5; cursor: wait; }
.cv-date { margin-right: auto; font-size: 11px; color: var(--text-tertiary); }
.cv-loading-more { padding: 10px; text-align: center; font-size: 11px; color: var(--text-tertiary); }
.cv-retry-more { display: block; width: 100%; color: #ff8a65; }

.cv-floor { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; padding: 10px 12px; border-radius: 10px;}
.cv-floor-status { padding: 8px; color: var(--text-tertiary); font-size: 11px; text-align: center; }
.cv-floor-status.error { width: 100%; color: #ff8a65; }
.cv-floor-item { display: flex; gap: 9px; padding-bottom: 9px; border-bottom: 1px solid var(--border); }
.cv-floor-item:last-of-type { padding-bottom: 0; border-bottom: 0; }
.cv-floor-avatar { width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; object-fit: cover; }
.cv-floor-body { flex: 1; min-width: 0; }
.cv-floor-head { display: flex; align-items: center; gap: 8px; }
.cv-floor-head strong { overflow: hidden; color: var(--text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cv-floor-head span { margin-left: auto; color: var(--text-tertiary); font-size: 9px; }
.cv-floor-body > p { margin: 3px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.55; word-break: break-word; }
.cv-floor-actions { display: flex; align-items: center; gap: 10px; margin-top: 5px; color: var(--text-tertiary); font-size: 9px; }
.cv-floor-actions button { color: var(--text-tertiary); font-size: 10px; }
.cv-floor-actions button:hover, .cv-floor-actions button.liked { color: var(--accent); }
.cv-floor-actions .cv-delete-btn:hover, .cv-floor-actions .cv-delete-btn.confirming { color: #ff4d4f; }
.cv-floor-more { align-self: center; padding: 5px 12px; border-radius: 12px; color: var(--accent); background: var(--accent-soft); font-size: 10px; }
.cv-floor-more:disabled { opacity: 0.55; cursor: wait; }

.cv-input-area { border-top: 1px solid var(--border); padding: 12px 24px; flex-shrink: 0; }
.cv-login-hint {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px; font-size: 12px; color: var(--text-tertiary);
}
.cv-login-hint button { margin-left: 4px; padding: 5px 10px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-size: 11px; }
.cv-risk-hint {
  display: flex; align-items: center; gap: 7px; margin-bottom: 8px; padding: 8px 10px;
  border: 1px solid rgba(255, 138, 101, 0.24); border-radius: 8px;
  background: rgba(255, 138, 101, 0.08); color: #ff8a65; font-size: 11px;
}
.cv-risk-hint span { flex: 1; }
.cv-risk-hint button { color: inherit; font-size: 16px; line-height: 1; }
.cv-reply-hint {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; margin-bottom: 8px; border-radius: 6px;
  font-size: 12px; color: var(--text-secondary);
}
.cv-cancel-reply { width: 20px; height: 20px; border-radius: 50%; color: var(--text-tertiary); font-size: 16px; line-height: 1; }
.cv-cancel-reply:hover { color: var(--text); background: var(--bg-hover); }
.cv-input-row { display: flex; align-items: center; gap: 8px; }
.cv-input {
  flex: 1; height: 38px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--text); font-size: 13px; transition: border-color 0.15s;
}
.cv-input:focus { outline: none; border-color: var(--accent); }
.cv-input::placeholder { color: var(--text-tertiary); }
.cv-char-count { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; min-width: 44px; text-align: center; }
.cv-char-count.warn { color: #ff4d4f; }
.cv-send-btn {
  padding: 10px 15px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: var(--accent); color: #fff; transition: opacity 0.15s;
}
.cv-send-btn:hover:not(:disabled) { opacity: 0.9; }
.cv-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
