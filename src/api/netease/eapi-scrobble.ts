/**
 * 网易云 EAPI 加密 + 听歌记录上报 (scrobble)
 *
 * EAPI 加密链:
 *   - md5("nobody" + path + "use" + payload + "md5forencrypt") 生成摘要
 *   - path + "-36cd479b6b5-" + payload + "-36cd479b6b5-" + digest 拼接明文
 *   - AES-128-ECB (key=e82ckenh8dichen8, PKCS#7) 加密
 *   - 输出大写 hex 作为表单字段 params
 *
 * 转换自 Go SDK: cloudmusic-report-sdk-go/eapi/eapi.go
 */

import { log } from "@/composables/logger";
import { scrobbleLog } from "./scrobble-log";

const TAG = "eapi-scrobble";
const DOMAIN = "https://music.163.com";
const APP_VERSION = "3.1.35.205293";
const EAPI_KEY = "e82ckenh8dichen8";
const EAPI_SALT = "36cd479b6b5";

// ===== MD5 实现 (纯 JS, 因为 Web Crypto API 不支持 MD5) =====

const md5_s = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const md5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function md5(data: Uint8Array): Uint8Array {
  const msg = data;
  const len = msg.length;
  // padding
  const bitLen = len * 8;
  const padLen = ((len + 8) >> 6) + 1;
  const padded = new Uint8Array(padLen * 64);
  padded.set(msg);
  padded[len] = 0x80;
  // length (64-bit LE)
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen * 64 - 8, bitLen >>> 0, true);
  dv.setUint32(padLen * 64 - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let i = 0; i < padded.length; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = dv.getUint32(i + j * 4, true);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number; let g: number;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * j) % 16; }
      F = (F + A + md5_K[j] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << md5_s[j]) | (F >>> (32 - md5_s[j])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  return out;
}

function md5Hex(data: Uint8Array): string {
  const hash = md5(data);
  return Array.from(hash).map(b => b.toString(16).padStart(2, "0")).join("");
}

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToHex(bytes: Uint8Array, upper = false): string {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return upper ? hex.toUpperCase() : hex;
}

// ===== AES-128-ECB 实现 (纯 JS, 使用 Web Crypto API 不支持 ECB 的 fallback) =====

const aesSbox = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const aesRcon = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function aesKeyExpansion(key: Uint8Array): Uint8Array {
  const Nk = key.length / 4; // 4 for AES-128
  const Nr = Nk + 6; // 10 for AES-128
  const w = new Uint8Array(4 * 4 * (Nr + 1));
  w.set(key);
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
    if (i % Nk === 0) {
      const tmp = t0;
      t0 = aesSbox[t1] ^ aesRcon[i / Nk - 1];
      t1 = aesSbox[t2];
      t2 = aesSbox[t3];
      t3 = aesSbox[tmp];
    }
    w[i * 4] = w[(i - Nk) * 4] ^ t0;
    w[i * 4 + 1] = w[(i - Nk) * 4 + 1] ^ t1;
    w[i * 4 + 2] = w[(i - Nk) * 4 + 2] ^ t2;
    w[i * 4 + 3] = w[(i - Nk) * 4 + 3] ^ t3;
  }
  return w;
}

function aesSubBytes(state: Uint8Array) {
  for (let i = 0; i < 16; i++) state[i] = aesSbox[state[i]];
}

function aesShiftRows(state: Uint8Array) {
  let t: number;
  t = state[1]; state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t;
  t = state[2]; state[2] = state[10]; state[10] = t; t = state[6]; state[6] = state[14]; state[14] = t;
  t = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = state[3]; state[3] = t;
}

function aesMixColumns(state: Uint8Array) {
  for (let c = 0; c < 4; c++) {
    const s0 = state[c * 4], s1 = state[c * 4 + 1], s2 = state[c * 4 + 2], s3 = state[c * 4 + 3];
    state[c * 4]     = gmul(s0, 2) ^ gmul(s1, 3) ^ s2 ^ s3;
    state[c * 4 + 1] = s0 ^ gmul(s1, 2) ^ gmul(s2, 3) ^ s3;
    state[c * 4 + 2] = s0 ^ s1 ^ gmul(s2, 2) ^ gmul(s3, 3);
    state[c * 4 + 3] = gmul(s0, 3) ^ s1 ^ s2 ^ gmul(s3, 2);
  }
}

function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function aesAddRoundKey(state: Uint8Array, w: Uint8Array, round: number) {
  for (let i = 0; i < 16; i++) state[i] ^= w[round * 16 + i];
}

function aesEncryptBlock(block: Uint8Array, w: Uint8Array): Uint8Array {
  const state = new Uint8Array(block);
  aesAddRoundKey(state, w, 0);
  for (let round = 1; round < 10; round++) {
    aesSubBytes(state);
    aesShiftRows(state);
    aesMixColumns(state);
    aesAddRoundKey(state, w, round);
  }
  aesSubBytes(state);
  aesShiftRows(state);
  aesAddRoundKey(state, w, 10);
  return state;
}

function pkcs7Pad(data: Uint8Array, blockSize: number): Uint8Array {
  const padding = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + padding);
  padded.set(data);
  padded.fill(padding, data.length);
  return padded;
}

function aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const w = aesKeyExpansion(key);
  const padded = pkcs7Pad(data, 16);
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    const block = aesEncryptBlock(padded.subarray(i, i + 16), w);
    out.set(block, i);
  }
  return out;
}

// ===== EAPI 加密 =====

function eapiEncrypt(path: string, params: Record<string, any>): string {
  const payload = JSON.stringify(params);
  const digest = md5Hex(strToBytes("nobody" + path + "use" + payload + "md5forencrypt"));
  const raw = path + "-" + EAPI_SALT + "-" + payload + "-" + EAPI_SALT + "-" + digest;
  const encrypted = aesEcbEncrypt(strToBytes(EAPI_KEY), strToBytes(raw));
  return bytesToHex(encrypted, true);
}

function apiToEAPIURL(path: string): string {
  return DOMAIN + "/eapi/" + path.replace("/api/", "").split("?")[0];
}

// ===== Cookie 解析 =====

function parseCookieHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  raw = raw.trim();
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const name = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      if (name) out[name] = value;
    }
  }
  return out;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

function randomDeviceID(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return bytesToHex(arr).padStart(32, "0").repeat(2).slice(0, 32);
}

// ===== EAPI 客户端 =====

export class EapiClient {
  deviceID: string;
  cookies: Record<string, string>;

  constructor(rawCookie: string) {
    this.deviceID = randomDeviceID();
    this.cookies = { os: "pc", appver: APP_VERSION, ...parseCookieHeader(rawCookie) };
  }

  /** POST /api/feedback/weblog */
  async feedbackWeblog(logs: any[]): Promise<any> {
    return this.eapiPost("/api/feedback/weblog", { logs: JSON.stringify(logs) });
  }

  /** 执行一次 EAPI 加密 POST 请求 */
  async eapiPost(path: string, payload: Record<string, any>): Promise<any> {
    const bodyPayload = { ...payload };
    bodyPayload["header"] = JSON.stringify({
      os: "pc",
      appver: APP_VERSION,
      deviceId: this.deviceID,
      requestId: "0",
      osver: "Microsoft-Windows-10",
    });

    const params = eapiEncrypt(path, bodyPayload);
    const url = apiToEAPIURL(path);
    const formData = `params=${encodeURIComponent(params)}`;

    log.info(TAG, "EAPI POST", { url, path });
    await scrobbleLog(`[EAPI] POST ${url}`);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) NeteaseMusicDesktop/${APP_VERSION} Safari/537.36`,
        "Origin": DOMAIN,
        "Referer": DOMAIN + "/",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookieHeader(this.cookies),
      },
      body: formData,
    });

    const text = await resp.text();
    let out: any;
    try { out = JSON.parse(text); } catch { out = { raw: text }; }
    out.http_status = resp.status;
    log.info(TAG, "EAPI response", { path, status: resp.status, code: out.code });
    await scrobbleLog(`[EAPI] response status=${resp.status} code=${out.code}`, { body: text.slice(0, 500) });
    return out;
  }

  /**
   * 完整听歌记录上报: startplay + play 两次请求
   *   - startplay: 进入「最近播放」
   *   - play (end=playend): 计入「听歌排行 / 听歌量」
   */
  async scrobble(songID: string, sourceID: string, playTime: number): Promise<any> {
    if (!sourceID) sourceID = songID;
    if (playTime <= 0) playTime = 60;

    await scrobbleLog(`[EAPI] === scrobble 开始 === songId=${songID} sourceId=${sourceID} time=${playTime}s`);

    // scrobble 模块强制 os=osx
    this.cookies["os"] = "osx";

    // 1. startplay
    const startplayLogs = [{
      action: "startplay",
      json: {
        id: songID, type: "song", mainsite: "1", mainsiteWeb: "1",
        content: "id=" + sourceID,
      },
    }];
    const res1 = await this.feedbackWeblog(startplayLogs);
    log.info(TAG, "startplay result", { code: res1.code });
    await scrobbleLog(`[EAPI] startplay 完成 code=${res1.code} http=${res1.http_status}`);

    // 2. play
    const playLogs = [{
      action: "play",
      json: {
        download: 0, end: "playend", id: songID, sourceId: sourceID, time: playTime,
        type: "song", wifi: 0, source: "list", mainsite: "1", mainsiteWeb: "1",
        content: "id=" + sourceID,
      },
    }];
    const res2 = await this.feedbackWeblog(playLogs);
    log.info(TAG, "play result", { code: res2.code });
    await scrobbleLog(`[EAPI] play 完成 code=${res2.code} http=${res2.http_status}`);

    await scrobbleLog(`[EAPI] === scrobble 结束 ===`);
    return {
      code: 200,
      message: "scrobble 上报成功",
      details: { startplay: res1, play: res2 },
    };
  }
}
