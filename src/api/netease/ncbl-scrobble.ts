/**
 * 网易云 NCBL 加密封包 + PLV/PLD 上报 (scrobble_v1)
 *
 * NCBL 格式: 70 字节固定头 + meta 块 + 多帧加密 body
 * 加密链: ChaCha20(动态密钥A) 加密 body 压缩分帧,
 * ChaCha20(RSA-256包裹的密钥B) 加密 meta JSON,
 * RSA-256 模数 N 已被因式分解, 可直接用公钥加密 keyA。
 *
 * 转换自 Go SDK: cloudmusic-report-sdk-go/ncbl/ncbl.go + client.go
 */

import { log } from "@/composables/logger";

const TAG = "ncbl-scrobble";
const CLIENT_LOG_HOST = "https://clientlog3.music.163.com";
const UPLOAD_PATH = "/api/clientlog/encrypt/upload?multiupload=true";

const MAGIC = "NCBL";
const NCBL_VERSION = 3;
const HEADER_FIXED_LEN = 70;
const META_BLOCK_TYPE = 0x4343;
const DEFAULT_MAX_FRAME = 0x8000; // 32KB
const FIELD_SEP = "\x01";

// RSA-256 模数 (已被因式分解)
const RSA_N = 0xfd90bd466ff9bc8a3fec2fbcf263b90d5c564879fa5d7aab89b31c1d5cb4139dn;
const RSA_E = 65537n;

// ===== Context / Song / Source 类型 =====

export interface NcblContext {
  app: {
    version: string;
    versionCode: string;
    channel: string;
    nsm: string;
    cid: string;
  };
  device: {
    id: string;
    ti: string;
    sign: string;
    systemType: string;
    systemVersion: string;
    nnid: string;
    nuid: string;
    csrf: string;
  };
  auth: {
    id: string;
    token: string;      // MUSIC_U
    sessionId: string;  // JSESSIONID-WYYY
    vipType: string;
  };
}

export interface NcblSong {
  id: number;
  name: string;
  artist: string;
  bitrate: number;
  level: string;
  vip: boolean;
  time: number; // 总时长(秒)
}

export interface NcblSource {
  id: string;
  type: string; // "track"
  name: string; // "list"
}

// ===== 辅助函数 =====

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

function uint16LE(val: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, val & 0xffff, true);
  return buf;
}

function uint32LE(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val >>> 0, true);
  return buf;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ===== ChaCha20 实现 (纯 JS) =====

const CHACHA_SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number) {
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 7);
}

function chachaBlock(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const state = new Uint32Array(16);
  state[0] = CHACHA_SIGMA[0]; state[1] = CHACHA_SIGMA[1];
  state[2] = CHACHA_SIGMA[2]; state[3] = CHACHA_SIGMA[3];
  const keyDV = new DataView(key.buffer, key.byteOffset);
  for (let i = 0; i < 8; i++) state[4 + i] = keyDV.getUint32(i * 4, true);
  state[12] = counter;
  const nonceDV = new DataView(nonce.buffer, nonce.byteOffset);
  state[13] = nonceDV.getUint32(0, true);
  state[14] = nonceDV.getUint32(4, true);
  state[15] = nonceDV.getUint32(8, true);

  const work = new Uint32Array(state);
  for (let i = 0; i < 10; i++) {
    quarterRound(work, 0, 4, 8, 12); quarterRound(work, 1, 5, 9, 13);
    quarterRound(work, 2, 6, 10, 14); quarterRound(work, 3, 7, 11, 15);
    quarterRound(work, 0, 5, 10, 15); quarterRound(work, 1, 6, 11, 12);
    quarterRound(work, 2, 7, 8, 13); quarterRound(work, 3, 4, 9, 14);
  }

  const out = new Uint8Array(64);
  const outDV = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outDV.setUint32(i * 4, (work[i] + state[i]) >>> 0, true);
  return out;
}

function chacha20(key: Uint8Array, counter: number, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 64) {
    const ks = chachaBlock(key, counter + Math.floor(off / 64), nonce);
    const end = Math.min(off + 64, data.length);
    for (let i = off; i < end; i++) out[i] = data[i] ^ ks[i - off];
  }
  return out;
}

// ===== RSA-256 Key Wrap (BigInt) =====

function rsaWrap(keyA: Uint8Array): Uint8Array {
  // keyA → BigInt (big-endian)
  let m = 0n;
  for (const b of keyA) m = (m << 8n) | BigInt(b);
  const c = (m ** BigInt(RSA_E)) % RSA_N;
  // BigInt → 32 bytes big-endian
  const result = new Uint8Array(32);
  let tmp = c;
  for (let i = 31; i >= 0; i--) {
    result[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  return result;
}

// ===== gzip 压缩 (使用浏览器 CompressionStream API) =====

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const compressed = stream.pipeThrough(new CompressionStream("gzip"));
  const reader = compressed.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ===== NCBL 加密 =====

export async function ncblEncrypt(metaJSON: Uint8Array, body: Uint8Array): Promise<Uint8Array> {
  // 1. 生成 keyA (32 bytes), 首字节若 >= 0xa3 则强制改为 0xa2
  const keyA = randomBytes(32);
  if (keyA[0] >= 0xa3) keyA[0] = 0xa2;

  // 2. RSA-256 Key Wrap: keyA → keyB
  const keyB = rsaWrap(keyA);

  // 3. 生成 UUID (16 bytes, v4 变体)
  const uid = randomBytes(16);
  uid[6] = (uid[6] & 0x0f) | 0x40; // version 4
  uid[8] = (uid[8] & 0x3f) | 0x80; // variant 10
  const nonce = uid.subarray(0, 12);
  const counter = new DataView(uid.buffer, uid.byteOffset + 12).getUint32(0, true) >>> 2;

  // baseSeq
  const seqBuf = randomBytes(2);
  const baseSeq = new DataView(seqBuf.buffer).getUint16(0, true);

  // 4. 加密 meta 块
  const metaCipher = chacha20(keyB, counter, nonce, metaJSON);
  const metaBlock = concatBytes(uint16LE(META_BLOCK_TYPE), uint16LE(metaCipher.length), metaCipher);
  const headerLen = HEADER_FIXED_LEN + metaBlock.length;

  // 5. 压缩 body (gzip)
  const compressed = await gzipCompress(body);

  // 6. 分帧加密
  const frameParts: Uint8Array[] = [];
  let seq = baseSeq;
  for (let off = 0; off < compressed.length || off === 0; off += DEFAULT_MAX_FRAME) {
    const end = Math.min(off + DEFAULT_MAX_FRAME, compressed.length);
    const slice = compressed.subarray(off, end);
    const cipherSlice = chacha20(keyA, counter, nonce, slice);
    frameParts.push(concatBytes(uint16LE(cipherSlice.length), uint32LE(seq), cipherSlice));
    seq++;
    if (compressed.length === 0) break;
  }
  const frameCount = seq - baseSeq;
  const frames = concatBytes(...frameParts);

  // 7. 组装固定头
  const header = new Uint8Array(HEADER_FIXED_LEN);
  header.set(strToBytes(MAGIC), 0);          // 0-3: magic
  header.set(uint32LE(NCBL_VERSION), 4);     // 4-7: version
  header.set(uint16LE(headerLen), 8);        // 8-9: headerLen
  header.set(uid, 10);                       // 10-25: uuid
  header.set(keyB, 26);                      // 26-57: keyB
  header.set(uint32LE(baseSeq), 58);         // 58-61: firstSeq
  header.set(uint32LE(baseSeq + frameCount - 1), 62); // 62-65: lastSeq
  header.set(uint32LE(frames.length), 66);   // 66-69: bodyLen

  return concatBytes(header, metaBlock, frames);
}

// ===== Record 构建 =====

interface NcblRecord {
  time: number;
  action: string;
  data: any;
}

function buildRecords(records: NcblRecord[]): Uint8Array {
  const parts: string[] = [];
  for (const r of records) {
    const dataStr = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    parts.push(`${r.time}${FIELD_SEP}${r.action}${FIELD_SEP}${dataStr}`);
  }
  return strToBytes(parts.join(""));
}

// ===== PLV / PLD 构建 =====

function buildPlv(ctx: NcblContext, song: NcblSong, source: NcblSource): any {
  const now = Date.now();
  const srcID = source.id || String(song.id);
  const srcName = source.name || "list";
  const srcType = source.type || "track";
  const addRefer = `[F:63][${now}#933#${ctx.app.version}#${ctx.app.versionCode}#c9156c3][e][2][23][cell_pc_songlist_song:2|page_pc_songlist_songflow|page_mine_like_music][${song.id}:song:x:x|:::|${srcID}:list::]`;
  const multiRefers = [
    "[F:26][s][18][_ai]",
    "[F:26][s][12][_ai]",
    `[F:63][${now}#933#${ctx.app.version}#${ctx.app.versionCode}#c9156c3][e][2][8][cell_pc_main_tab_entrance:6|page_pc_main_tab][我喜欢的音乐:spm::|:::]`,
    "[F:26][s][5][_ai]",
    "[F:26][s][0][_ai]",
  ];
  return {
    mode: "circulation", download: 0, alg: "", status: "front",
    id: String(song.id), bitrate: song.bitrate, type: "song",
    is_listentogether: 0, source: srcName, is_heart: 0,
    resource_ratio: "", resource_time: song.time, musiceffect_id: "",
    app_mode: 2, bitrate_level: song.level, _addrefer: addRefer,
    _multirefers: multiRefers, vipType: ctx.auth.vipType,
    fee: 1, file: 4, rightSource: 0, sourceId: srcID,
    sourcetype: srcType, libra_abt: "", channel: ctx.app.channel,
    curStartChannel: "",
  };
}

function buildPld(ctx: NcblContext, song: NcblSong, source: NcblSource, played: number): any {
  const now = Date.now();
  const srcID = source.id || String(song.id);
  const srcName = source.name || "list";
  const srcType = source.type || "track";
  const addRefer = `[F:63][${now}#616#${ctx.app.version}#${ctx.app.versionCode}#c9156c3][e][2][92][btn_pc_cover_play|cell_pc_songlist_song:6|page_pc_songlist_songflow|page_mine_like_music][:::|${song.id}:song:x:x|:::|${srcID}:list::]`;
  const multiRefers = [
    "[F:26][s][87][_ai]", "[F:26][s][81][_ai]", "[F:26][s][75][_ai]",
    "[F:26][s][69][_ai]", "[F:26][s][63][_ai]",
  ];
  return {
    mode: "circulation", download: 0, alg: "", status: "front",
    id: String(song.id), time: played, type: "song",
    is_listentogether: 0, source: srcName, is_heart: 0,
    realtime: played, resource_ratio: "", resource_time: song.time,
    musiceffect_id: "1001", app_mode: 1, lyriceffect: "default",
    displayMode: "classic", bitrate: song.bitrate, bitrate_level: song.level,
    _addrefer: addRefer, _multirefers: multiRefers, vipType: ctx.auth.vipType,
    fee: 8, file: 4, rightSource: 0, sourceId: srcID,
    sourcetype: srcType, end: "interrupt", libra_abt: "",
    channel: ctx.app.channel, curStartChannel: "",
  };
}

// ===== Meta JSON / Cookie 构建 =====

function buildMetaJSON(ctx: NcblContext): Uint8Array {
  const meta: Record<string, string> = {
    "JSESSIONID-WYYY": ctx.auth.sessionId,
    "MUSIC_U": ctx.auth.token,
    "NMTID": ctx.device.ti,
    "WEVNSM": ctx.app.nsm,
    "WNMCID": ctx.app.cid,
    "__csrf": ctx.device.csrf,
    "_iuqxldmzr_": "33",
    "_ntes_nnid": ctx.device.nnid,
    "_ntes_nuid": ctx.device.nuid,
    "appver": ctx.app.version + "." + ctx.app.versionCode,
    "channel": ctx.app.channel,
    "clientSign": ctx.device.sign,
    "deviceId": ctx.device.id,
    "mode": "",
    "ntes_kaola_ad": "1",
    "os": ctx.device.systemType,
    "osver": ctx.device.systemVersion,
  };
  return strToBytes(JSON.stringify(meta));
}

function buildCookieStr(ctx: NcblContext): string {
  return `JSESSIONID-WYYY=${ctx.auth.sessionId}; MUSIC_U=${ctx.auth.token}; NMTID=${ctx.device.ti}; WEVNSM=${ctx.app.nsm}; WNMCID=${ctx.app.cid}; __csrf=${ctx.device.csrf}; __remember_me=true; _iuqxldmzr_=33; _ntes_nnid=${ctx.device.nnid}; _ntes_nuid=${ctx.device.nuid}; appver=${ctx.app.version}.${ctx.app.versionCode}; channel=${ctx.app.channel}; clientSign=${ctx.device.sign}; deviceId=${ctx.device.id}; ntes_kaola_ad=1; os=${ctx.device.systemType}; osver=${ctx.device.systemVersion}`;
}

function randomFileName(): string {
  const r1 = randomBytes(4);
  const r2 = randomBytes(2);
  const a = (r1[0] << 24) | (r1[1] << 16) | (r1[2] << 8) | r1[3];
  const b = (r2[0] << 8) | r2[1];
  return `op_${a >>> 0}_0_${b >>> 0}`;
}

// ===== NCBL 上传 =====

async function ncblUpload(ctx: NcblContext, metaJSON: Uint8Array, body: Uint8Array, cookieStr: string): Promise<any> {
  const payload = await ncblEncrypt(metaJSON, body);
  const fileName = randomFileName();

  // 构建 multipart/form-data
  const boundary = "----WebKitFormBoundary" + bytesToHex(randomBytes(8));
  const before = strToBytes(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: multipart/form-data\r\n\r\n`);
  const after = strToBytes(`\r\n--${boundary}--\r\n`);
  const formData = concatBytes(before, payload, after);

  log.info(TAG, "NCBL upload", { fileName, payloadLen: payload.length });

  const resp = await fetch(CLIENT_LOG_HOST + UPLOAD_PATH, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Referer": "https://music.163.com/di",
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/${ctx.app.version}`,
      "Accept-Encoding": "identity",
      "Accept-Language": "zh-CN,zh;q=0.8",
      "Cookie": cookieStr,
    },
    body: formData as unknown as BodyInit,
  });

  const text = await resp.text();
  let respBody: any;
  try { respBody = JSON.parse(text); } catch { respBody = { raw: text }; }
  respBody.http_status = resp.status;

  const success = respBody.code === 200 &&
    respBody.data?.successfiles?.includes(fileName);

  log.info(TAG, "NCBL response", { fileName, status: resp.status, code: respBody.code, success });
  return { success, fileName, payloadLen: payload.length, respBody };
}

// ===== 完整 scrobble_v1 (PLV + PLD) =====

export async function ncblScrobbleV1(
  ctx: NcblContext,
  song: NcblSong,
  source: NcblSource,
  playTime: number
): Promise<{ code: number; message: string; plv?: any; pld?: any }> {
  if (!ctx.auth.token) {
    return { code: 401, message: "缺少 MUSIC_U 鉴权令牌" };
  }
  if (playTime <= 0) playTime = 60;
  let played = playTime;
  if (song.time > 0 && played > song.time) played = song.time;

  const metaJSON = buildMetaJSON(ctx);
  const cookieStr = buildCookieStr(ctx);
  const ts = Math.floor(Date.now() / 1000);

  // 1. 上传 PLV
  const plvRecord = buildPlv(ctx, song, source);
  const plvBody = buildRecords([{ time: ts, action: "_plv", data: plvRecord }]);
  const plvResult = await ncblUpload(ctx, metaJSON, plvBody, cookieStr);
  if (!plvResult.success) {
    return { code: 500, message: "PLV 上报失败", plv: plvResult };
  }

  // 2. 上传 PLD
  const pldRecord = buildPld(ctx, song, source, played);
  const pldBody = buildRecords([{ time: ts, action: "_pld", data: pldRecord }]);
  const pldResult = await ncblUpload(ctx, metaJSON, pldBody, cookieStr);
  if (!pldResult.success) {
    return { code: 500, message: "PLV 成功但 PLD 失败", plv: plvResult, pld: pldResult };
  }

  return { code: 200, message: "scrobble_v1 上报成功", plv: plvResult, pld: pldResult };
}

// ===== 从 cookie 字符串构建 Context =====

export function buildNcblContext(rawCookie: string): NcblContext {
  const cookies: Record<string, string> = {};
  for (const part of rawCookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) cookies[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }

  return {
    app: {
      version: "3.1.35",
      versionCode: "205293",
      channel: cookies["channel"] || "netease",
      nsm: cookies["WEVNSM"] || "1.0.0",
      cid: cookies["WNMCID"] || "abc123.1700000000.01.0",
    },
    device: {
      id: cookies["deviceId"] || cookies["sDeviceId"] || randomBytes(16).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "").slice(0, 32),
      ti: cookies["NMTID"] || "",
      sign: cookies["clientSign"] || "",
      systemType: "pc",
      systemVersion: cookies["osver"] || "Microsoft-Windows-10-Professional-build-19045-64bit",
      nnid: cookies["_ntes_nnid"] || ",",
      nuid: cookies["_ntes_nuid"] || "",
      csrf: cookies["__csrf"] || "",
    },
    auth: {
      id: "",
      token: cookies["MUSIC_U"] || "",
      sessionId: cookies["JSESSIONID-WYYY"] || "",
      vipType: cookies["vipType"] || "",
    },
  };
}
