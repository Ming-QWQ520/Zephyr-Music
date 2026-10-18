<script setup lang="ts">
/**
 * MessageView - 私信页面
 *
 * 设计要点：
 *   - 左侧联系人列表 + 右侧聊天窗口
 *   - 卡片风格与 ProfileView 一致
 *   - 高内聚：私信相关逻辑集中于此组件
 *
 * 数据来源：
 *   - msgPrivate (api/netease/social)        私信列表（含最后消息预览）
 *   - msgPrivateHistory (api/netease/social)  聊天记录
 *   - sendText (api/netease/social)           发送私信
 *
 * 重要：必须使用 msgPrivate 加载联系人列表，而不是 msgRecentContact！
 *   - msgPrivate 返回的是有私信对话的联系人列表（含 lastMsg、lastMsgTime 等）
 *   - msgRecentContact 返回的是关注列表中的联系人，不一定有私信记录
 */
import { ref, onMounted, nextTick, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  msgPrivate,
  msgPrivateHistory,
  sendText,
} from "@/api/netease/social";
import { _cachedUser } from "@/api/netease/core";
import { log } from "@/composables/logger";
import Icon from "@/components/Icon.vue";

const store = usePlayerStore();

// ===== 会话列表 =====
interface Contact {
  userId: number;
  nickname: string;
  avatarUrl: string;
  lastMsg?: string;
  lastMsgTime?: number;
  newMsgCount?: number;  // 未读消息数
  mutual?: boolean;     // 是否互相关注
  onlined?: boolean;    // 是否在线
}
const contacts = ref<Contact[]>([]);
const loadingContacts = ref(false);
const activeContact = ref<Contact | null>(null);
const hasMore = ref(false);
const contactOffset = ref(0);

// ===== 聊天记录 =====
interface ChatMsg {
  id: string;
  fromUserId: number;
  toUserId: number;
  content: string;
  time: number;
  isSelf: boolean;
}
const chatMessages = ref<ChatMsg[]>([]);
const loadingMessages = ref(false);
const chatMore = ref(false);
const chatContainerRef = ref<HTMLElement | null>(null);

// ===== 发送消息 =====
const inputMsg = ref("");
const sending = ref(false);

// ===== 错误状态 =====
const contactError = ref("");
const chatError = ref("");

// 内联 SVG 图标
const SVG_MAIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
const SVG_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="m22 2-11 11"/></svg>`;
const SVG_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`;

/**
 * 解析 msg 字段（网易云 API 的 msg 是 JSON 字符串，需要提取实际文本）
 * 支持多种格式：
 *   - 纯文本字符串
 *   - JSON 字符串 {"msg":"实际文本",...}
 *   - 对象 {msg:"实际文本",...}
 */
function parseMsgField(rawMsg: any): string {
  if (!rawMsg) return "";
  if (typeof rawMsg === "string") {
    if (rawMsg.startsWith("{")) {
      try {
        const parsed = JSON.parse(rawMsg);
        return parsed.msg || parsed.title || parsed.content || rawMsg;
      } catch {
        return rawMsg;
      }
    }
    return rawMsg;
  }
  if (typeof rawMsg === "object") {
    return rawMsg.msg || rawMsg.title || rawMsg.content || JSON.stringify(rawMsg);
  }
  return String(rawMsg);
}

// ===== 加载会话列表 =====
async function loadContacts(append = false) {
  if (loadingContacts.value) return;
  loadingContacts.value = true;
  contactError.value = "";

  if (!append) {
    contactOffset.value = 0;
  }

  try {
    const myId = _cachedUser.value?.userId || 0;
    const r = await msgPrivate(50, contactOffset.value);

    log.info("MessageView", "msgPrivate response", {
      code: r.code,
      keys: Object.keys(r),
      msgsLen: r.msgs?.length || 0,
      more: r.more,
    });

    // 关键：msgPrivate 返回的数据在 r.msgs 中（不是 r.follow！）
    // r.msgs 是一个数组，每个元素包含 fromUser, toUser, lastMsg, lastMsgTime, newMsgCount
    const list = r.msgs || [];
    hasMore.value = !!r.more;

    const newContacts = list.map((item: any) => {
      // 判断对方：fromUser 不是自己就是 fromUser，否则是 toUser
      const fromId = item.fromUser?.userId || 0;
      const other = fromId !== myId ? item.fromUser : item.toUser;

      return {
        userId: other?.userId || 0,
        nickname: other?.nickname || "未知用户",
        avatarUrl: other?.avatarUrl || "",
        lastMsg: parseMsgField(item.lastMsg),
        lastMsgTime: item.lastMsgTime || 0,
        newMsgCount: item.newMsgCount || 0,
        mutual: !!other?.mutual,
        onlined: !!other?.onlined,
      };
    });

    if (append) {
      contacts.value = [...contacts.value, ...newContacts];
    } else {
      contacts.value = newContacts;
    }
    contactOffset.value += newContacts.length;
  } catch (e) {
    log.warn("MessageView", "loadContacts error:", e);
    contactError.value = "加载失败，请重试";
    if (!append) contacts.value = [];
  } finally {
    loadingContacts.value = false;
  }
}

// ===== 加载更多联系人 =====
async function loadMoreContacts() {
  if (!hasMore.value || loadingContacts.value) return;
  await loadContacts(true);
}

// ===== 选择联系人 → 加载聊天记录 =====
async function selectContact(contact: Contact) {
  if (activeContact.value?.userId === contact.userId) return;
  activeContact.value = contact;
  chatMessages.value = [];
  chatMore.value = false;
  await loadChatHistory();
}

async function loadChatHistory() {
  if (!activeContact.value) return;
  loadingMessages.value = true;
  chatError.value = "";

  try {
    const uid = activeContact.value.userId;
    const r = await msgPrivateHistory(uid, 50);

    log.info("MessageView", "msgPrivateHistory response", {
      uid,
      code: r.code,
      keys: Object.keys(r),
      msgsLen: r.msgs?.length || 0,
      more: r.more,
    });

    // 兼容两种字段名：msgs（实际）和 msg（可能的旧版）
    const list = r.msgs || [];
    chatMore.value = !!r.more;
    const myId = _cachedUser.value?.userId || 0;

    // API 返回的消息是倒序的（最新在前），需要反转为正序（旧消息在上，新消息在下）
    chatMessages.value = list.map((item: any): ChatMsg => {
      const fromId = item.fromUser?.userId || 0;
      return {
        id: String(item.id || Math.random()),
        fromUserId: fromId,
        toUserId: item.toUser?.userId || 0,
        content: parseMsgField(item.msg),
        time: item.time || 0,
        isSelf: fromId === myId,
      };
    }).reverse();
  } catch (e) {
    log.warn("MessageView", "loadChatHistory error:", e);
    chatError.value = "加载消息失败";
    chatMessages.value = [];
  } finally {
    // 先关闭 loading 状态，让模板渲染消息列表（而非加载动画）
    loadingMessages.value = false;
    // 等待 DOM 更新后再滚动到底部
    await nextTick();
    scrollToBottom();
  }
}

// ===== 加载更多消息（向上翻页） =====
async function loadMoreMessages() {
  if (!activeContact.value || !chatMore.value || loadingMessages.value) return;
  loadingMessages.value = true;

  try {
    const uid = activeContact.value.userId;
    const before = chatMessages.value.length
      ? chatMessages.value[0].time
      : undefined;
    const r = await msgPrivateHistory(uid, 30, before);
    const list = r.msgs || [];
    chatMore.value = !!r.more;
    const myId = _cachedUser.value?.userId || 0;

    // API 返回的旧消息也是倒序的，需要反转为正序后再插入顶部
    const older = list.map((item: any): ChatMsg => {
      const fromId = item.fromUser?.userId || 0;
      return {
        id: String(item.id || Math.random()),
        fromUserId: fromId,
        toUserId: item.toUser?.userId || 0,
        content: parseMsgField(item.msg),
        time: item.time || 0,
        isSelf: fromId === myId,
      };
    }).reverse();

    // 将旧消息插入到顶部
    chatMessages.value = [...older, ...chatMessages.value];
  } catch (e) {
    log.warn("MessageView", "loadMoreMessages error:", e);
  } finally {
    loadingMessages.value = false;
  }
}

// ===== 发送消息 =====
async function doSend() {
  if (!inputMsg.value.trim() || !activeContact.value || sending.value) return;
  sending.value = true;
  const uid = String(activeContact.value.userId);
  const msg = inputMsg.value.trim();

  try {
    await sendText(uid, msg);
    inputMsg.value = "";
    // 发送成功后刷新聊天记录
    await loadChatHistory();
    // 同时刷新联系人列表（更新最后消息）
    await loadContacts();
  } catch (e) {
    log.warn("MessageView", "sendText error:", e);
  } finally {
    sending.value = false;
  }
}

function scrollToBottom() {
  if (chatContainerRef.value) {
    chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight;
  }
}

function formatMsgTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isToday) return time;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`;
}

function goBack() {
  store.setView("recommend");
}

// 监听用户登录状态变化，自动加载联系人
watch(() => _cachedUser.value, (newVal) => {
  if (newVal) {
    loadContacts();
  } else {
    contacts.value = [];
    activeContact.value = null;
    chatMessages.value = [];
  }
});

onMounted(() => {
  if (_cachedUser.value) {
    loadContacts();
  }
});
</script>

<template>
  <section class="message-view nice-scroll">
    <!-- 未登录空状态 -->
    <div v-if="!_cachedUser" class="msg-empty">
      <span class="empty-icon" v-html="SVG_MAIL" />
      <p>请登录后查看私信</p>
      <button class="empty-back-btn" @click="goBack">返回</button>
    </div>

    <!-- 已登录 -->
    <template v-else>
      <div class="msg-layout">
        <!-- 左侧：联系人列表 -->
        <div class="contact-panel">
          <div class="panel-title">
            <Icon name="mail" :size="16" />
            <span>私信</span>
            <span v-if="contacts.length" class="panel-count">{{ contacts.length }}</span>
          </div>

          <div v-if="loadingContacts && !contacts.length" class="section-loading"><span class="spinner-sm" /></div>
          <div v-else-if="contactError" class="section-error">
            <p>{{ contactError }}</p>
            <button class="retry-btn" @click="loadContacts()">
              <span class="retry-icon" v-html="SVG_REFRESH" />
              重试
            </button>
          </div>
          <div v-else-if="contacts.length" class="contact-list nice-scroll">
            <div
              v-for="c in contacts"
              :key="c.userId"
              class="contact-item"
              :class="{ active: activeContact?.userId === c.userId }"
              @click="selectContact(c)"
            >
              <div class="contact-avatar" :class="{ online: c.onlined }">
                <img v-if="c.avatarUrl" :src="c.avatarUrl" alt="" referrerpolicy="no-referrer" />
                <span v-else class="avatar-fallback">{{ c.nickname.charAt(0) }}</span>
                <span v-if="c.onlined" class="online-dot" />
              </div>
              <div class="contact-info">
                <div class="contact-name-row">
                  <span class="contact-name">{{ c.nickname }}</span>
                  <span v-if="c.mutual" class="mutual-badge">互关</span>
                  <span v-if="c.lastMsgTime" class="contact-time">{{ formatMsgTime(c.lastMsgTime) }}</span>
                </div>
                <div v-if="c.lastMsg" class="contact-preview">{{ c.lastMsg }}</div>
                <span v-if="c.newMsgCount" class="unread-badge">{{ c.newMsgCount > 99 ? '99+' : c.newMsgCount }}</span>
              </div>
            </div>
            <!-- 加载更多联系人 -->
            <button v-if="hasMore" class="load-more-contacts" @click="loadMoreContacts" :disabled="loadingContacts">
              {{ loadingContacts ? '加载中...' : '加载更多' }}
            </button>
          </div>
          <div v-else class="section-empty">暂无私信</div>
        </div>

        <!-- 右侧：聊天窗口 -->
        <div class="chat-panel">
          <template v-if="activeContact">
            <!-- 聊天头部 -->
            <div class="chat-header">
              <img v-if="activeContact.avatarUrl" :src="activeContact.avatarUrl" class="chat-avatar" referrerpolicy="no-referrer" />
              <span class="chat-name">{{ activeContact.nickname }}</span>
            </div>

            <!-- 消息列表 -->
            <div ref="chatContainerRef" class="chat-messages nice-scroll">
              <div v-if="loadingMessages" class="section-loading"><span class="spinner-sm" /></div>
              <div v-else-if="chatError" class="section-error">
                <p>{{ chatError }}</p>
                <button class="retry-btn" @click="loadChatHistory()">
                  <span class="retry-icon" v-html="SVG_REFRESH" />
                  重试
                </button>
              </div>
              <template v-else>
                <!-- 加载更多 -->
                <button v-if="chatMore" class="load-more-btn" @click="loadMoreMessages">加载更早消息</button>
                <div
                  v-for="msg in chatMessages"
                  :key="msg.id"
                  class="msg-bubble-row"
                  :class="{ self: msg.isSelf }"
                >
                  <div class="msg-bubble">
                    <span class="msg-text">{{ msg.content }}</span>
                    <span class="msg-time">{{ formatMsgTime(msg.time) }}</span>
                  </div>
                </div>
                <div v-if="!chatMessages.length" class="section-empty">暂无消息</div>
              </template>
            </div>

            <!-- 输入框 -->
            <div class="chat-input-bar">
              <input
                v-model="inputMsg"
                class="chat-input"
                type="text"
                placeholder="输入消息..."
                :disabled="sending"
                @keydown.enter="doSend"
              />
              <button class="send-btn" :disabled="!inputMsg.trim() || sending" @click="doSend">
                <span class="send-icon" v-html="SVG_SEND" />
              </button>
            </div>
          </template>

          <!-- 未选择联系人 -->
          <div v-else class="chat-placeholder">
            <span class="placeholder-icon" v-html="SVG_MAIL" />
            <p>选择一个联系人开始聊天</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.message-view {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.msg-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  padding: 24px;
}
.msg-empty p { font-size: 15px; margin: 4px 0 8px; color: var(--text-secondary); }
.empty-icon { display: inline-flex; color: var(--text-tertiary); }
.empty-icon :deep(svg) { width: 48px; height: 48px; display: block; }
.empty-back-btn {
  padding: 6px 18px; border-radius: var(--radius-full);
  font-size: 13px; color: var(--text-secondary);
  border: 1px solid var(--border); background: var(--bg-elev-1);
  transition: color 0.18s var(--ease-out), background 0.18s var(--ease-out);
}
.empty-back-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

/* ===== 布局 ===== */
.msg-layout {
  display: flex;
  height: 100%;
  gap: 0;
  overflow: hidden;
}

/* ===== 联系人面板 ===== */
.contact-panel {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev-1);
  border-right: 1px solid var(--border);
  border-radius: var(--radius) 0 0 var(--radius);
  overflow: hidden;
}
.panel-title {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 18px 12px;
  font-size: 15px; font-weight: 700;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}
.panel-title :deep(.icon-svg) { color: var(--accent); }
.panel-count {
  font-size: 11px; color: var(--text-tertiary);
  font-weight: 500;
  margin-left: 2px;
}
.contact-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.contact-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.12s var(--ease-out);
}
.contact-item:hover { background: var(--bg-hover); }
.contact-item.active { background: var(--accent-soft); }
.contact-avatar {
  width: 40px; height: 40px;
  border-radius: var(--radius-full);
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg-elev-3);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.contact-avatar img { width: 100%; height: 100%; object-fit: cover; }
.contact-avatar.online { box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.35); }
.online-dot {
  position: absolute;
  bottom: 1px; right: 1px;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid var(--bg-elev-1);
}
.avatar-fallback {
  font-size: 16px; font-weight: 600; color: var(--text-tertiary);
}
.contact-info { flex: 1; min-width: 0; position: relative; }
.contact-name-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px;
}
.contact-name {
  font-size: 13px; font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mutual-badge {
  font-size: 9px; font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 1px 4px;
  flex-shrink: 0;
  line-height: 1.3;
}
.contact-time {
  font-size: 10px; color: var(--text-tertiary);
  flex-shrink: 0;
}
.contact-preview {
  margin: 2px 0 0;
  font-size: 11px; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 160px;
}
.unread-badge {
  position: absolute;
  top: -4px; right: -4px;
  min-width: 16px; height: 16px;
  border-radius: 8px;
  background: #ef4444;
  color: #fff;
  font-size: 10px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px;
  line-height: 1;
}
.load-more-contacts {
  width: 100%;
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s var(--ease-out);
}
.load-more-contacts:hover { color: var(--accent); }
.load-more-contacts:disabled { opacity: 0.5; cursor: not-allowed; }

/* ===== 聊天面板 ===== */
.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-radius: 0 var(--radius) var(--radius) 0;
  overflow: hidden;
}
.chat-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-1);
}
.chat-avatar {
  width: 32px; height: 32px;
  border-radius: var(--radius-full);
  object-fit: cover;
}
.chat-name {
  font-size: 14px; font-weight: 600; color: var(--text);
}

/* ===== 消息列表 ===== */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.load-more-btn {
  align-self: center;
  padding: 4px 16px;
  border-radius: var(--radius-full);
  font-size: 12px;
  color: var(--text-tertiary);
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.load-more-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.msg-bubble-row {
  display: flex;
  justify-content: flex-start;
}
.msg-bubble-row.self {
  justify-content: flex-end;
}
.msg-bubble {
  max-width: 65%;
  padding: 8px 14px;
  border-radius: var(--radius);
  background: var(--bg-elev-1);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.msg-bubble-row.self .msg-bubble {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.msg-text {
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
  word-break: break-word;
}
.msg-time {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: right;
}

/* ===== 输入框 ===== */
.chat-input-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev-1);
}
.chat-input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s var(--ease-out);
}
.chat-input:focus { border-color: var(--accent); }
.chat-input::placeholder { color: var(--text-tertiary); }
.send-btn {
  width: 36px; height: 36px;
  border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  background: var(--accent-soft);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn:not(:disabled):hover { opacity: 0.85; }
.send-btn:not(:disabled):active { transform: scale(0.92); }
.send-icon { display: inline-flex; }
.send-icon :deep(svg) { width: 18px; height: 18px; display: block; }

/* ===== 占位 ===== */
.chat-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
}
.placeholder-icon { display: inline-flex; }
.placeholder-icon :deep(svg) { width: 48px; height: 48px; display: block; }
.chat-placeholder p { font-size: 14px; }

/* ===== 错误状态 ===== */
.section-error {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 20px 0;
  gap: 8px;
  color: var(--text-tertiary);
}
.section-error p { font-size: 12px; margin: 0; }
.retry-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  cursor: pointer;
  transition: opacity 0.15s;
}
.retry-btn:hover { opacity: 0.85; }
.retry-icon { display: inline-flex; }
.retry-icon :deep(svg) { width: 12px; height: 12px; display: block; }

/* ===== 通用 ===== */
.section-loading {
  display: flex; align-items: center; justify-content: center;
  padding: 20px 0;
  color: var(--text-tertiary);
}
.spinner-sm {
  width: 18px; height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
.section-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}

/* ===== 响应式 ===== */
@media (max-width: 760px) {
  .contact-panel { width: 220px; }
}
</style>

<style>
body.has-wallpaper .message-view .contact-panel,
body.has-wallpaper .message-view .chat-panel,
body.has-wallpaper .message-view .chat-header,
body.has-wallpaper .message-view .chat-input-bar {
  background: rgba(33, 31, 38, 0.55);
  backdrop-filter: blur(3px) saturate(1.8);
  -webkit-backdrop-filter: blur(3px) saturate(1.8);
  border-color: rgba(255, 255, 255, 0.10);
}
body.has-wallpaper .message-view .msg-bubble {
  background: rgba(33, 31, 38, 0.55);
  backdrop-filter: blur(3px) saturate(1.8);
  -webkit-backdrop-filter: blur(3px) saturate(1.8);
  border-color: rgba(255, 255, 255, 0.10);
}
body.has-wallpaper .message-view .msg-bubble-row.self .msg-bubble {
  background: rgba(250, 35, 59, 0.18);
  border-color: rgba(250, 35, 59, 0.35);
  backdrop-filter: blur(3px) saturate(1.8);
  -webkit-backdrop-filter: blur(3px) saturate(1.8);
}
body.has-wallpaper .message-view .contact-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
body.has-wallpaper .message-view .contact-item.active {
  background: rgba(250, 35, 59, 0.18);
}
body.has-wallpaper .message-view .chat-input {
  background: rgba(33, 31, 38, 0.55);
  border-color: rgba(255, 255, 255, 0.10);
}
</style>
