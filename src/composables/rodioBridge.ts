function isLocalFile(url: string): boolean {
  return url.startsWith("localaudio://") || url.startsWith("localfile://") || /^[A-Z]:[\\/]/.test(url);
}
async function invoke<T>(cmd: string, args?: any): Promise<T | null> {
  try { const mod = await import("@tauri-apps/api/core"); return await mod.invoke<T>(cmd, args); }
  catch { return null; }
}
export async function rodioPlay(path: string): Promise<number> { return (await invoke<number>("rodio_play", { path })) ?? 0; }
export async function rodioPause(): Promise<void> { await invoke("rodio_pause"); }
export async function rodioResume(): Promise<void> { await invoke("rodio_resume"); }
export async function rodioStop(): Promise<void> { await invoke("rodio_stop"); }
export async function rodioSetVolume(vol: number): Promise<void> { await invoke("rodio_set_volume", { volume: vol }); }
export { isLocalFile };
