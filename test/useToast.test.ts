/**
 * useToast 单元测试
 *
 * 测试 Toast 通知系统的添加、移除、自动消失等逻辑。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToast } from "@/composables/useToast";

describe("useToast", () => {
  beforeEach(() => {
    // 每次测试前清空所有 toast
    const { toasts, remove } = useToast();
    toasts.value.forEach(t => remove(t.id));
    // 重置 setTimeout mock
    vi.restoreAllMocks();
  });

  it("初始状态 toasts 为空", () => {
    const { toasts } = useToast();
    // 可能有其他测试遗留，清理后应为空
    toasts.value = [];
    expect(toasts.value).toEqual([]);
  });

  it("show() 添加一条 toast", () => {
    const { show, toasts } = useToast();
    toasts.value = [];
    const id = show({ title: "测试通知" });
    expect(id).toBeGreaterThan(0);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].title).toBe("测试通知");
  });

  it("show() 默认类型为 success", () => {
    const { show, toasts } = useToast();
    toasts.value = [];
    show({ title: "默认类型" });
    expect(toasts.value[0].type).toBe("success");
  });

  it("show() 默认时长为 3000ms", () => {
    const { show, toasts } = useToast();
    toasts.value = [];
    show({ title: "默认时长" });
    expect(toasts.value[0].duration).toBe(3000);
  });

  it("success() 便捷方法", () => {
    const { success, toasts } = useToast();
    toasts.value = [];
    success("成功", "操作完成");
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].type).toBe("success");
    expect(toasts.value[0].title).toBe("成功");
    expect(toasts.value[0].subtitle).toBe("操作完成");
  });

  it("error() 默认时长 5000ms", () => {
    const { error, toasts } = useToast();
    toasts.value = [];
    error("错误", "出错了");
    expect(toasts.value[0].type).toBe("error");
    expect(toasts.value[0].duration).toBe(5000);
  });

  it("warning() 默认时长 4000ms", () => {
    const { warning, toasts } = useToast();
    toasts.value = [];
    warning("警告", "注意");
    expect(toasts.value[0].type).toBe("warning");
    expect(toasts.value[0].duration).toBe(4000);
  });

  it("info() 便捷方法", () => {
    const { info, toasts } = useToast();
    toasts.value = [];
    info("信息", "提示内容");
    expect(toasts.value[0].type).toBe("info");
    expect(toasts.value[0].title).toBe("信息");
    expect(toasts.value[0].subtitle).toBe("提示内容");
  });

  it("remove() 移除指定 toast", () => {
    const { show, remove, toasts } = useToast();
    toasts.value = [];
    const id1 = show({ title: "通知1" });
    const id2 = show({ title: "通知2" });
    expect(toasts.value).toHaveLength(2);
    remove(id1);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].id).toBe(id2);
  });

  it("remove() 移除不存在的 id 不报错", () => {
    const { remove, toasts } = useToast();
    toasts.value = [];
    expect(() => remove(99999)).not.toThrow();
  });

  it("show() 返回递增的 id", () => {
    const { show, toasts } = useToast();
    toasts.value = [];
    const id1 = show({ title: "1" });
    const id2 = show({ title: "2" });
    const id3 = show({ title: "3" });
    expect(id2).toBeGreaterThan(id1);
    expect(id3).toBeGreaterThan(id2);
  });

  it("show() 设置 actionUrl 和 actionText", () => {
    const { show, toasts } = useToast();
    toasts.value = [];
    show({
      title: "已添加",
      actionUrl: "playlist:123",
      actionText: "查看",
    });
    expect(toasts.value[0].actionUrl).toBe("playlist:123");
    expect(toasts.value[0].actionText).toBe("查看");
  });

  it("show() duration=0 不自动消失", () => {
    vi.useFakeTimers();
    const { show, toasts } = useToast();
    toasts.value = [];
    show({ title: "不消失", duration: 0 });
    expect(toasts.value).toHaveLength(1);
    // 快进 10 秒
    vi.advanceTimersByTime(10000);
    expect(toasts.value).toHaveLength(1);
    vi.useRealTimers();
  });

  it("show() 自动消失", () => {
    vi.useFakeTimers();
    const { show, toasts } = useToast();
    toasts.value = [];
    show({ title: "自动消失", duration: 1000 });
    expect(toasts.value).toHaveLength(1);
    // 快进 500ms，不应消失
    vi.advanceTimersByTime(500);
    expect(toasts.value).toHaveLength(1);
    // 快进到 1000ms 后，应消失
    vi.advanceTimersByTime(501);
    expect(toasts.value).toHaveLength(0);
    vi.useRealTimers();
  });

  it("createdAt 时间戳被设置", () => {
    const { show, toasts } = useToast();
    toasts.value = [];
    const before = Date.now();
    show({ title: "时间戳" });
    const after = Date.now();
    expect(toasts.value[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(toasts.value[0].createdAt).toBeLessThanOrEqual(after);
  });

  it("所有调用者共享同一个 toasts 列表（单例）", () => {
    const t1 = useToast();
    const t2 = useToast();
    t1.toasts.value = [];
    t1.success("来自 t1");
    expect(t2.toasts.value).toHaveLength(1);
    expect(t2.toasts.value[0].title).toBe("来自 t1");
  });
});
