/** 时间/数字格式化工具 */
export function formatTime(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 格式化大数字（万/亿） */
export function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

/** 格式化总听歌时长（秒 → x小时y分钟） */
export function formatListenTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0分钟";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

/** 安全地截断长字符串/对象用于日志输出。
 *  obj 可以是任意值：字符串直接截断，其他类型先 JSON.stringify。 */
export function truncateForLog(obj: unknown, maxLen = 500): string {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    if (!s) return String(s);
    return s.length > maxLen ? s.slice(0, maxLen) + `...(truncated, total ${s.length} chars)` : s;
  } catch { return String(obj); }
}
