function ts(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0")+"."+String(d.getMilliseconds()).padStart(3,"0");
}
function fmt(level: string, tag: string, msg: string, data?: any): string {
  let line = `[${ts()}] ${level} [${tag}] ${msg}`;
  if (data !== undefined) { try { line += " " + (typeof data === "string" ? data : JSON.stringify(data)); } catch { line += " " + String(data); } }
  return line;
}
async function write(level: string, tag: string, msg: string, data?: any) {
  const line = fmt(level, tag, msg, data);
  if (level === "ERROR") console.error(line); else if (level === "WARN") console.warn(line); else console.log(line);
  try { const mod = await import("@tauri-apps/api/core"); await mod.invoke("write_log", { message: line }); } catch {}
}
let initialized = false;
async function ensureInit() { if (initialized) return; initialized = true; try { const mod = await import("@tauri-apps/api/core"); await mod.invoke("init_log"); } catch {} }
export const log = {
  info: (tag: string, msg: string, data?: any) => write("INFO", tag, msg, data),
  warn: (tag: string, msg: string, data?: any) => write("WARN", tag, msg, data),
  error: (tag: string, msg: string, data?: any) => write("ERROR", tag, msg, data),
  debug: (tag: string, msg: string, data?: any) => write("DEBUG", tag, msg, data),
  init: ensureInit,
};
