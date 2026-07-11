/**
 * 通用 debounce 工具
 *
 * - `debounce(fn, delay)`: 经典 debounce，返回带 .cancel() 的新函数
 * - `useDebounceRef(initial, delay)`: 返回一个 ref，写入会被 debounce；
 *   另返回一个 `cancel` 函数用于立即取消挂起的写入。
 *
 * 适用场景：搜索框输入防抖、resize 监听防抖等。
 */
import { ref, type Ref } from "vue";

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 300,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

export function useDebounceRef<T>(initial: T, delay = 300): {
  value: Ref<T>;
  set: (v: T) => void;
  cancel: () => void;
  flush: () => void;
} {
  const value = ref(initial) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | undefined;
  let hasPending = false;

  const set = (v: T) => {
    pending = v;
    hasPending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (hasPending) {
        value.value = pending as T;
        hasPending = false;
      }
    }, delay);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    hasPending = false;
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (hasPending) {
      value.value = pending as T;
      hasPending = false;
    }
  };

  return { value, set, cancel, flush };
}
