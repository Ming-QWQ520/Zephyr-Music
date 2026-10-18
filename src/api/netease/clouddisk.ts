/**
 * 网易云音乐云盘相关 API
 *
 * 接口列表：
 *   - GET  /user/cloud          获取云盘数据（列表）
 *   - GET  /user/cloud/detail    云盘数据详情
 *   - GET  /user/cloud/del       删除云盘歌曲
 *   - POST /cloud/upload/token   获取上传凭证（客户端直传模式）
 *   - PUT  {uploadUrl}           直传文件到云存储
 *   - POST /cloud/upload/complete 完成上传导入
 *   - GET  /cloud/match          云盘歌曲信息匹配纠正
 *   - GET  /cloud/lyric/get      获取云盘歌词
 */
import { log } from "@/composables/logger";
import { apiGet, apiPost, getCookie, TAG } from "./core";
import { neteaseSongToSong } from "./transform";
import type { Song, NeteaseSong } from "@/types";

// ===== 类型定义 =====

/** 云盘歌曲（API 返回的原始结构）
 *  注意：API 返回的每项可能是 { songId, songName, singer, ... } 或 { song: { id, name, ar, al, ... } }
 *  simpleSong 字段可能包含完整的网易云歌曲对象 */
export interface CloudDiskSong {
  songId: number;
  songName: string;
  singer: string;
  album: string;
  fileSize: number;
  addTime: number;
  /** 简化字段，也含 song 对象 */
  simpleSong?: NeteaseSong;
  /** 完整的 song 对象（部分 API 版本返回） */
  song?: NeteaseSong;
  /** artists 字段（部分 API 版本） */
  artists?: { id: number; name: string }[];
  /** ar 字段（网易云标准格式） */
  ar?: { id: number; name: string }[];
  /** al 字段（专辑信息） */
  al?: { id: number; name: string; picUrl: string };
  /** picUrl */
  picUrl?: string;
  /** dt / duration */
  dt?: number;
  duration?: number;
}

/** 云盘列表响应 */
export interface CloudDiskListResult {
  code: number;
  count?: number;
  data?: CloudDiskSong[];
  hasMore?: boolean;
  size?: number;
}

/** 上传凭证响应 — 注意 normalizeResponse 会解包 data 层，所以实际返回的就是 data 内容 */
export interface CloudUploadTokenResult {
  code: number;
  needUpload?: boolean;
  songId?: string;
  uploadToken?: string;
  uploadUrl?: string;
  resourceId?: string;
  objectKey?: string;
  bucket?: string;
  md5?: string;
  fileSize?: number;
  filename?: string;
  /** 原始 data 对象（未解包时） */
  data?: {
    needUpload: boolean;
    songId: string;
    uploadToken: string;
    uploadUrl: string;
    resourceId: string;
    objectKey?: string;
    bucket?: string;
  };
}

/** 上传完成响应 */
export interface CloudUploadCompleteResult {
  code: number;
  songId?: string;
}

// ===== API 函数 =====

/** 获取云盘数据（列表）
 *  limit: 返回数量，默认 30
 *  offset: 偏移数量，默认 0 */
export async function userCloud(limit = 30, offset = 0): Promise<CloudDiskListResult> {
  log.info(TAG, "→ userCloud()", { limit, offset });
  const r = await apiGet<CloudDiskListResult>("/user/cloud", { limit, offset });
  log.info(TAG, "← userCloud result", { code: r.code, count: r.data?.length || 0 });
  return r;
}

/** 云盘数据详情
 *  id: 歌曲 ID，可多个用逗号隔开 */
export async function userCloudDetail(id: number | string): Promise<{ code: number; data?: any[] }> {
  log.info(TAG, "→ userCloudDetail()", { id });
  const r = await apiGet("/user/cloud/detail", { id });
  log.info(TAG, "← userCloudDetail result", { code: r.code });
  return r;
}

/** 删除云盘歌曲
 *  id: 歌曲 ID，可多个用逗号隔开 */
export async function userCloudDel(id: number | string): Promise<{ code: number }> {
  log.info(TAG, "→ userCloudDel()", { id });
  const r = await apiGet<{ code: number }>("/user/cloud/del", { id });
  log.info(TAG, "← userCloudDel result", { code: r.code });
  return r;
}

/** 获取上传凭证（客户端直传模式第一步）
 *  md5: 文件 MD5 值
 *  fileSize: 文件大小（字节）
 *  filename: 文件名
 *  注意：cookie 由 apiPost 自动附加，但文档要求 cookie 在 body 中，这里显式传 */
export async function cloudUploadToken(
  md5: string,
  fileSize: number,
  filename: string
): Promise<CloudUploadTokenResult> {
  log.info(TAG, "→ cloudUploadToken()", { md5: md5.slice(0, 16) + "...", fileSize, filename });
  const cookie = getCookie();
  const r = await apiPost<CloudUploadTokenResult>("/cloud/upload/token", {
    cookie,
    md5,
    fileSize,
    filename,
  });
  // normalizeResponse 解包了 data，所以 needUpload/songId/resourceId 在顶层
  // 完整记录响应以便排查 API 缓存问题
  const tokenData = (r.data || r) as CloudUploadTokenResult;
  log.info(TAG, "← cloudUploadToken result", {
    code: r.code,
    needUpload: tokenData.needUpload,
    songId: tokenData.songId ? String(tokenData.songId).slice(0, 32) : null,
    resourceId: tokenData.resourceId ? String(tokenData.resourceId) : null,
    returnedMd5: tokenData.md5 ? String(tokenData.md5).slice(0, 16) : null,
    sentMd5: md5.slice(0, 16),
    md5Match: tokenData.md5 === md5,
  });
  return r;
}

/** 直传文件到云存储（客户端直传模式第二步）
 *  PUT 文件到 uploadUrl（不带 Authorization header，网易云使用 token 在 URL 或 body 中）
 *  onProgress: 上传字节进度回调 (loaded, total)，已节流到 250ms 避免高频更新卡顿
 *  返回是否成功 */
export async function cloudDirectUpload(
  uploadUrl: string,
  file: File,
  _uploadToken: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<boolean> {
  log.info(TAG, "→ cloudDirectUpload()", { url: uploadUrl.slice(0, 80) + "...", fileSize: file.size });
  return new Promise<boolean>((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", "audio/mpeg");
      // 上传进度事件节流：XHR progress 事件可能每 50ms 触发一次，导致 UI 卡顿
      let lastProgressUpdate = 0;
      if (xhr.upload && onProgress) {
        xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
          if (e.lengthComputable) {
            const now = Date.now();
            // 至少 250ms 间隔，或完成时立即触发
            if (now - lastProgressUpdate >= 250 || e.loaded >= e.total) {
              lastProgressUpdate = now;
              onProgress(e.loaded, e.total);
            }
          }
        });
      }
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          const ok = xhr.status === 200 || xhr.status === 204;
          log.info(TAG, "← cloudDirectUpload result", { status: xhr.status, ok });
          if (!ok) {
            log.warn(TAG, "cloudDirectUpload response body", {
              status: xhr.status,
              body: (xhr.responseText || "").slice(0, 200),
            });
          }
          // 无论成功失败都通知 100% 完成
          if (onProgress) onProgress(file.size, file.size);
          resolve(ok);
        }
      };
      xhr.onerror = () => {
        log.error(TAG, "✗ cloudDirectUpload network error");
        resolve(false);
      };
      xhr.ontimeout = () => {
        log.error(TAG, "✗ cloudDirectUpload timeout");
        resolve(false);
      };
      xhr.timeout = 5 * 60 * 1000; // 5 分钟超时（大文件）
      xhr.send(file);
    } catch (e) {
      log.error(TAG, "✗ cloudDirectUpload failed", { error: String(e) });
      resolve(false);
    }
  });
}

/** 完成上传导入（客户端直传模式第三步）
 *  songId: 歌曲 ID
 *  resourceId: 资源 ID
 *  md5: 文件 MD5
 *  filename: 文件名
 *  song/artist/album: 可选元数据 */
export async function cloudUploadComplete(
  songId: string,
  resourceId: string,
  md5: string,
  filename: string,
  options?: { song?: string; artist?: string; album?: string }
): Promise<CloudUploadCompleteResult> {
  log.info(TAG, "→ cloudUploadComplete()", { songId, resourceId, filename });
  const cookie = getCookie();
  const params: Record<string, string | number> = { cookie, songId, resourceId, md5, filename };
  if (options?.song) params.song = options.song;
  if (options?.artist) params.artist = options.artist;
  if (options?.album) params.album = options.album;
  const r = await apiPost<CloudUploadCompleteResult>("/cloud/upload/complete", params);
  log.info(TAG, "← cloudUploadComplete result", { code: r.code, songId: r.songId });
  return r;
}

/** 上传进度回调的详细数据 */
export interface UploadProgressData {
  /** 当前阶段 */
  phase: "md5" | "token" | "uploading" | "complete" | "import";
  /** 当前阶段已完成字节（md5/uploading 阶段有意义） */
  loaded: number;
  /** 当前阶段总字节 */
  total: number;
  /** 上传速度（字节/秒，仅 uploading 阶段有意义） */
  speed: number;
  /** 阶段文本描述 */
  phaseText: string;
}

/** 完整的客户端直传上传流程（基于本地文件路径，使用 Rust 命令避免 CORS）
 *  每首歌独立完成完整的上传流程：MD5 → token → PUT → complete
 *
 *  1. 用 Rust 计算文件 MD5（带进度事件）
 *  2. 获取上传凭证（带重试：API 可能返回缓存的错误响应）
 *  3. 如果 needUpload=true，用 Rust reqwest 直传文件（避免前端 XHR CORS 限制）
 *  4. 完成导入
 *  返回上传后的 songId
 *
 * API 缓存问题处理：
 *  - 网易云 /cloud/upload/token API 有服务端缓存，同一会话内的连续请求可能返回第一个文件的响应
 *  - 通过检查返回的 md5 字段与发送的 md5 是否匹配来检测缓存命中
 *  - 如果 md5Match=false，说明 API 返回了缓存的错误响应，等待更长时间后重试
 *  - 最多重试 5 次，每次等待递增（5s, 8s, 12s, 15s, 20s） */
export async function cloudUploadByPath(
  filepath: string,
  filename: string,
  fileSize: number,
  taskId: string,
  onProgress?: (data: UploadProgressData) => void
): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  // 阶段1: 用 Rust 计算文件 MD5
  onProgress?.({ phase: "md5", loaded: 0, total: fileSize, speed: 0, phaseText: "计算文件 MD5..." });
  const md5Unlisten = await listen<{ loaded: number; total: number }>(`md5-progress-${taskId}`, (e) => {
    onProgress?.({ phase: "md5", loaded: e.payload.loaded, total: e.payload.total, speed: 0, phaseText: "计算文件 MD5..." });
  });
  let md5: string;
  try {
    md5 = await invoke<string>("compute_file_md5", { filepath, taskId });
  } catch (e) {
    md5Unlisten();
    log.error(TAG, "compute_file_md5 failed", { error: String(e) });
    return null;
  }
  md5Unlisten();
  log.info(TAG, "MD5 computed", { md5: md5.slice(0, 16) + "...", filename });

  // 阶段2: 获取上传凭证（带重试，处理 API 缓存问题）
  onProgress?.({ phase: "token", loaded: 0, total: 0, speed: 0, phaseText: "获取上传凭证..." });
  let tokenRes: CloudUploadTokenResult;
  let tokenData: any;
  const MAX_TOKEN_RETRIES = 5;
  const RETRY_DELAYS = [5000, 8000, 12000, 15000, 20000]; // 递增等待时间
  for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
    tokenRes = await cloudUploadToken(md5, fileSize, filename);
    tokenData = tokenRes.data || tokenRes;
    if (tokenRes.code !== 200 || tokenData.needUpload === undefined) {
      log.warn(TAG, "cloudUpload: token failed", { code: tokenRes.code, attempt });
      return null;
    }
    // 检查 API 是否返回了缓存的错误响应（md5 不匹配）
    const returnedMd5 = tokenData.md5;
    if (returnedMd5 && returnedMd5 !== md5) {
      const delay = RETRY_DELAYS[attempt] || 20000;
      log.warn(TAG, "cloudUpload: API returned cached response (md5 mismatch), retrying", {
        attempt: attempt + 1,
        maxRetries: MAX_TOKEN_RETRIES,
        delayMs: delay,
        sentMd5: md5.slice(0, 16),
        returnedMd5: String(returnedMd5).slice(0, 16),
        filename,
      });
      onProgress?.({ phase: "token", loaded: 0, total: 0, speed: 0, phaseText: `等待 API 缓存过期（重试 ${attempt + 1}/${MAX_TOKEN_RETRIES}，${Math.round(delay / 1000)}s）...` });
      // 等待递增时间后重试，让 API 缓存过期
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    // md5 匹配或没有 md5 字段，说明是正确的响应
    log.info(TAG, "cloudUpload: token OK (md5 matched or no md5 field)", { attempt: attempt + 1, filename });
    break;
  }

  const { needUpload, songId, uploadUrl, resourceId } = tokenData;
  const safeStr = (v: any): string => {
    if (v == null) return "null";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 32 ? s.slice(0, 32) + "..." : s;
  };
  log.info(TAG, "cloudUpload token", { needUpload, songId: safeStr(songId), resourceId: safeStr(resourceId), filename });

  if (needUpload) {
    // 阶段3: 用 Rust 直传文件（避免前端 XHR CORS 限制）
    onProgress?.({ phase: "uploading", loaded: 0, total: fileSize, speed: 0, phaseText: "上传文件中..." });
    const uploadUnlisten = await listen<{ loaded: number; total: number; done?: boolean; ok?: boolean }>(`upload-progress-${taskId}`, (e) => {
      const { loaded, total } = e.payload;
      onProgress?.({ phase: "uploading", loaded, total, speed: 0, phaseText: "上传文件中..." });
    });
    try {
      const ok = await invoke<boolean>("upload_file_stream", { url: uploadUrl || "", filepath, taskId });
      uploadUnlisten();
      if (!ok) {
        log.warn(TAG, "cloudUpload: direct upload failed");
        return null;
      }
      onProgress?.({ phase: "uploading", loaded: fileSize, total: fileSize, speed: 0, phaseText: "上传完成" });
    } catch (e) {
      uploadUnlisten();
      log.error(TAG, "upload_file_stream failed", { error: String(e) });
      return null;
    }
  } else {
    // 秒传
    onProgress?.({ phase: "uploading", loaded: fileSize, total: fileSize, speed: 0, phaseText: "秒传中..." });
    log.info(TAG, "cloudUpload: needUpload=false, skip direct upload (instant transfer)", { filename });
  }

  // 阶段4: 完成导入
  onProgress?.({ phase: "import", loaded: fileSize, total: fileSize, speed: 0, phaseText: "完成导入..." });
  const completeRes = await cloudUploadComplete(
    songId != null ? String(songId) : "",
    resourceId != null ? String(resourceId) : "",
    md5, filename
  );
  log.info(TAG, "cloudUpload complete", { code: completeRes.code, songId: safeStr(completeRes.songId), filename });
  if (completeRes.code !== 200 && completeRes.code !== 201) {
    log.warn(TAG, "cloudUpload: complete failed", { code: completeRes.code });
    return null;
  }

  onProgress?.({ phase: "complete", loaded: fileSize, total: fileSize, speed: 0, phaseText: "上传完成" });
  return completeRes.songId || songId || null;
}

/** 完整的客户端直传上传流程（基于 File 对象，浏览器 fallback）
 *  1. 计算文件 MD5（带分块进度）
 *  2. 获取上传凭证
 *  3. 如果 needUpload=true，直传文件（带字节进度+速度）
 *  4. 完成导入（无论 needUpload true/false 都需要调用，将文件注册到用户云盘）
 *  返回上传后的 songId
 *
 * needUpload=false 说明：
 *  - 服务器已有相同 MD5 的文件内容（去重存储），无需重新上传字节
 *  - 但仍需调用 cloudUploadComplete 将该资源注册到当前用户的云盘
 *  - token 返回的 songId 是资源标识符（所有用户共享），complete 后才变成用户私有记录
 */
export async function cloudUpload(
  file: File,
  onProgress?: (data: UploadProgressData) => void
): Promise<string | null> {
  // 阶段1: 计算 MD5（分块读取，每块完成时回调）
  onProgress?.({ phase: "md5", loaded: 0, total: file.size, speed: 0, phaseText: "计算文件 MD5..." });
  const md5 = await computeMD5(file, (loaded) => {
    onProgress?.({ phase: "md5", loaded, total: file.size, speed: 0, phaseText: "计算文件 MD5..." });
  });

  // 阶段2: 获取上传凭证
  onProgress?.({ phase: "token", loaded: 0, total: 0, speed: 0, phaseText: "获取上传凭证..." });
  const tokenRes = await cloudUploadToken(md5, file.size, file.name);
  const tokenData = tokenRes.data || tokenRes;
  if (tokenRes.code !== 200 || tokenData.needUpload === undefined) {
    log.warn(TAG, "cloudUpload: token failed", { code: tokenRes.code, hasData: !!tokenRes.data, needUpload: tokenData.needUpload });
    return null;
  }

  const { needUpload, songId, uploadToken, uploadUrl, resourceId } = tokenData;
  // resourceId/songId 可能是字符串、数字或对象，安全地转为字符串再截断用于日志
  const safeStr = (v: any): string => {
    if (v == null) return "null";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 32 ? s.slice(0, 32) + "..." : s;
  };
  log.info(TAG, "cloudUpload token", { needUpload, songId: safeStr(songId), resourceId: safeStr(resourceId), filename: file.name });

  if (needUpload) {
    // 阶段3: 直传文件（带字节进度和速度计算）
    onProgress?.({ phase: "uploading", loaded: 0, total: file.size, speed: 0, phaseText: "上传文件中..." });
    let lastTime = Date.now();
    let lastLoaded = 0;
    const uploadOk = await cloudDirectUpload(uploadUrl || "", file, uploadToken || "", (loaded, total) => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      let speed = 0;
      if (dt >= 0.2 && loaded > lastLoaded) {
        speed = (loaded - lastLoaded) / dt;
        lastTime = now;
        lastLoaded = loaded;
      }
      onProgress?.({ phase: "uploading", loaded, total, speed, phaseText: "上传文件中..." });
    });
    if (!uploadOk) {
      log.warn(TAG, "cloudUpload: direct upload failed");
      return null;
    }
  } else {
    // 秒传：服务器已有相同 MD5 的文件，跳过直传
    onProgress?.({ phase: "uploading", loaded: file.size, total: file.size, speed: 0, phaseText: "秒传中..." });
    log.info(TAG, "cloudUpload: needUpload=false, skip direct upload (instant transfer)", { filename: file.name });
  }

  // 阶段4: 完成导入（无论 needUpload true/false 都必须调用）
  // 这一步将资源注册到用户云盘，生成用户私有的歌曲记录
  // 注意：songId/resourceId 传给 API 时需要转为字符串
  onProgress?.({ phase: "import", loaded: file.size, total: file.size, speed: 0, phaseText: "完成导入..." });
  const completeRes = await cloudUploadComplete(
    songId != null ? String(songId) : "",
    resourceId != null ? String(resourceId) : "",
    md5, file.name
  );
  log.info(TAG, "cloudUpload complete", { code: completeRes.code, songId: safeStr(completeRes.songId), filename: file.name });
  if (completeRes.code !== 200 && completeRes.code !== 201) {
    log.warn(TAG, "cloudUpload: complete failed", { code: completeRes.code });
    return null;
  }

  onProgress?.({ phase: "complete", loaded: file.size, total: file.size, speed: 0, phaseText: "上传完成" });
  return completeRes.songId || songId || null;
}

/** 云盘歌曲信息匹配纠正
 *  uid: 用户 ID
 *  sid: 云盘歌曲 ID
 *  asid: 要匹配的歌曲 ID（传 0 取消匹配） */
export async function cloudMatch(
  uid: number,
  sid: string,
  asid: string
): Promise<{ code: number }> {
  log.info(TAG, "→ cloudMatch()", { uid, sid, asid });
  const r = await apiGet<{ code: number }>("/cloud/match", { uid, sid, asid });
  log.info(TAG, "← cloudMatch result", { code: r.code });
  return r;
}

/** 获取云盘歌词
 *  uid: 用户 ID
 *  sid: 云盘歌曲 ID */
export async function cloudLyric(
  uid: number,
  sid: string
): Promise<{ code: number; lrc?: { lyric: string }; tlyric?: { lyric: string } }> {
  log.info(TAG, "→ cloudLyric()", { uid, sid });
  const r = await apiGet("/cloud/lyric/get", { uid, sid });
  log.info(TAG, "← cloudLyric result", { code: r.code, hasLrc: !!r.lrc?.lyric });
  return r;
}

/** 直接获取云盘歌曲下载链接
 *  id: 云盘歌曲 ID
 *  返回 { code, data: { url } } 或 { code, url } */
export async function cloudDownload(id: number | string): Promise<{ code: number; url?: string; data?: { url?: string } }> {
  log.info(TAG, "→ cloudDownload()", { id });
  const r = await apiGet<{ code: number; url?: string; data?: { url?: string } }>("/song/cloud/download", { id });
  const url = r.url || r.data?.url || "";
  log.info(TAG, "← cloudDownload result", { code: r.code, hasUrl: !!url });
  return { code: r.code, url, data: r.data };
}

// ===== 工具函数 =====

/** 计算文件 MD5（分块读取避免大文件 OOM）
 *  onProgress: 每块完成时回调，参数为已处理字节数 */
async function computeMD5(file: File, onProgress?: (loaded: number) => void): Promise<string> {
  // 分块读取文件（每块 2MB）
  const chunkSize = 2 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const slice = file.slice(offset, Math.min(offset + chunkSize, file.size));
    const buf = await slice.arrayBuffer();
    chunks.push(new Uint8Array(buf));
    loaded += buf.byteLength;
    onProgress?.(loaded);
  }
  // 合并为一个 Uint8Array
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const data = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of chunks) {
    data.set(chunk, pos);
    pos += chunk.length;
  }
  return md5Hex(data);
}

/**
 * 纯 JS MD5 实现（基于 RFC 1321，经过验证的标准算法）
 * 支持 Uint8Array 输入，返回 32 字符小写 hex 字符串
 */
function md5Hex(data: Uint8Array): string {
  // 常量
  const S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ];
  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
  ];

  // 初始 hash 值
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // 预处理：padding
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  // padding 到 56 mod 64
  const padLen = (56 - (msgLen + 1) % 64 + 64) % 64;
  const totalLen = msgLen + 1 + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  // 追加原始长度（64-bit little-endian）
  const dv = new DataView(padded.buffer);
  dv.setUint32(totalLen - 8, bitLen >>> 0, true);
  dv.setUint32(totalLen - 4, Math.floor(bitLen / 0x100000000), true);

  // 处理每个 512-bit (64-byte) 块
  for (let off = 0; off < totalLen; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = dv.getUint32(off + i * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      // 模 2^32 加法
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      // 循环左移
      const s = S[i];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // 输出 little-endian hex
  const hex = (n: number): string => {
    let s = "";
    for (let i = 0; i < 4; i++) {
      const byte = (n >>> (i * 8)) & 0xff;
      s += byte.toString(16).padStart(2, "0");
    }
    return s;
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

/** 从云盘歌曲数据中提取艺术家名（兼容多种字段格式） */
export function getCloudArtist(cloudSong: CloudDiskSong): string {
  // 优先从 simpleSong 或 song 的 ar/artists 字段提取
  const songObj = cloudSong.simpleSong || cloudSong.song;
  if (songObj) {
    const ar = (songObj as any).ar || (songObj as any).artists;
    if (Array.isArray(ar) && ar.length > 0) {
      return ar.map((a: any) => a.name || "").filter(Boolean).join(", ");
    }
  }
  // 其次从顶层 ar/artists 字段提取
  if (cloudSong.ar && cloudSong.ar.length > 0) {
    return cloudSong.ar.map(a => a.name).filter(Boolean).join(", ");
  }
  if (cloudSong.artists && cloudSong.artists.length > 0) {
    return cloudSong.artists.map(a => a.name).filter(Boolean).join(", ");
  }
  // 最后 fallback 到 singer 字段
  if (cloudSong.singer) return cloudSong.singer;
  return "未知艺术家";
}

/** 从云盘歌曲数据中提取封面 URL */
export function getCloudCover(cloudSong: CloudDiskSong): string {
  const songObj = cloudSong.simpleSong || cloudSong.song;
  if (songObj) {
    const al = (songObj as any).al;
    if (al?.picUrl) return al.picUrl;
    if ((songObj as any).picUrl) return (songObj as any).picUrl;
  }
  if (cloudSong.al?.picUrl) return cloudSong.al.picUrl;
  if (cloudSong.picUrl) return cloudSong.picUrl;
  return "";
}

/** 从云盘歌曲数据中提取歌曲名 */
export function getCloudName(cloudSong: CloudDiskSong): string {
  const songObj = cloudSong.simpleSong || cloudSong.song;
  if (songObj?.name) return songObj.name;
  return cloudSong.songName || "未知歌曲";
}

/** 将云盘歌曲数据转为内部 Song 格式 */
export function cloudSongToSong(cloudSong: CloudDiskSong): Song {
  const songObj = cloudSong.simpleSong || cloudSong.song;
  // 优先用完整的网易云歌曲对象转换
  if (songObj && (songObj as any).id) {
    const song = neteaseSongToSong(songObj);
    // 确保 neteaseId 用云盘 songId
    song.neteaseId = cloudSong.songId;
    return song;
  }
  // fallback：手动构造，正确提取艺术家
  const artist = getCloudArtist(cloudSong);
  const picUrl = getCloudCover(cloudSong);
  const name = getCloudName(cloudSong);
  return {
    id: `cloud_${cloudSong.songId}`,
    name,
    artist,
    pic: picUrl,
    url: "",
    lrc: "",
    duration: (cloudSong.dt || cloudSong.duration || 0) / 1000 || 0,
    source: "netease",
    neteaseId: cloudSong.songId,
  };
}
