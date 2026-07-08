/**
 * Scrobble 独立日志 - 写到 exe目录/log/scrobble/[当天日期].log
 *
 * 通过 Tauri command write_scrobble_log 写入文件
 */

export async function scrobbleLog(message: string, data?: any) {
  const msg = data ? `${message} ${JSON.stringify(data)}` : message;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_scrobble_log", { message: msg });
  } catch {
    // 非 Tauri 环境（浏览器预览），输出到 console
    console.log(`[scrobble] ${msg}`);
  }
}
