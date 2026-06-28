import { ref } from "vue";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  /** 提示文本（主标题） */
  title: string;
  /** 子文本（副标题，可选） */
  subtitle?: string;
  /** 自动消失时间（毫秒），默认 2000ms，设为 0 则不自动消失 */
  duration?: number;
  /** 提示类型 */
  type?: ToastType;
  /** 可点击的返回 URL（可选，点击后跳转） */
  actionUrl?: string;
  /** actionUrl 的显示文字 */
  actionText?: string;
}

export interface ToastItem extends Required<Omit<ToastOptions, "subtitle" | "actionUrl" | "actionText">> {
  id: number;
  subtitle?: string;
  actionUrl?: string;
  actionText?: string;
}

const toasts = ref<ToastItem[]>([]);
let nextId = 0;

/**
 * Toast 提示系统（可复用接口）
 *
 * 显示在右下角，从右侧平滑弹出，自动消失。
 *
 * 用法：
 *   const { show, success } = useToast();
 *   success("添加成功", "已添加到「我的歌单」");
 *   show({ title: "已删除", subtitle: "歌曲已从歌单移除", type: "warning", duration: 3000 });
 *   show({ title: "添加成功", subtitle: "已添加到歌单", actionUrl: "/playlist/123", actionText: "查看" });
 */
export function useToast() {
  function remove(id: number) {
    const idx = toasts.value.findIndex(t => t.id === id);
    if (idx >= 0) toasts.value.splice(idx, 1);
  }

  function show(options: ToastOptions): number {
    const id = ++nextId;
    const item: ToastItem = {
      id,
      title: options.title,
      subtitle: options.subtitle,
      duration: options.duration ?? 2000,
      type: options.type ?? "success",
      actionUrl: options.actionUrl,
      actionText: options.actionText,
    };
    toasts.value.push(item);
    if (item.duration > 0) {
      setTimeout(() => remove(id), item.duration);
    }
    return id;
  }

  // 便捷方法
  const success = (title: string, subtitle?: string, duration?: number) =>
    show({ title, subtitle, duration, type: "success" });

  const error = (title: string, subtitle?: string, duration?: number) =>
    show({ title, subtitle, duration, type: "error" });

  const info = (title: string, subtitle?: string, duration?: number) =>
    show({ title, subtitle, duration, type: "info" });

  const warning = (title: string, subtitle?: string, duration?: number) =>
    show({ title, subtitle, duration, type: "warning" });

  return {
    toasts,
    show,
    remove,
    success,
    error,
    info,
    warning,
  };
}
