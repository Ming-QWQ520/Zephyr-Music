//! 安全持久化模块
//!
//! 负责三类数据的存储：
//!   1. 设置 (`data/settings.json`)          — 明文 JSON（由前端 tauri-plugin-store 直接写）
//!   2. Cookie (`data/cookie/cookies.dat`)   — AES-GCM 加密，密钥存于系统凭据库
//!   3. 播放列表 (`data/playlist.json`)       — 明文 JSON（退出前落盘）
//!
//! 加密方案（与用户设计一致）：
//!   - 32 字节随机密钥由 `rand` 生成，base64 编码后存入 OS 凭据管理器
//!     （Windows Credential Manager / macOS Keychain / Linux Secret Service）。
//!   - 密钥不出现在代码或磁盘明文中，只有应用本身通过系统 API 才能取回。
//!   - Cookie 用 AES-256-GCM 加密；每次写入生成随机 12 字节 nonce，前置拼接到密文前。
//!   - 即使 `cookies.dat` 文件被复制到其他机器/账户，没有对应系统凭据也无法解密。
//!
//! 说明：tauri-plugin-store v2.4.3 的 `StoreOptions` 并未提供 `encrypt` 字段，
//! 因此这里直接用 `aes-gcm` crate 在 Rust 端完成加密，前端通过 invoke 调用。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use keyring::Entry;
use rand::RngCore;
use std::fs;
use std::path::PathBuf;

/// 凭据库中的服务名 / 键名（用于存储 AES-256 加密密钥）
const SERVICE_NAME: &str = "zephyr-music";
const KEY_NAME: &str = "store-encryption-key";

/// 返回 exe 所在目录下的 `data` 目录，并确保所有子目录存在：
/// `data/`、`data/cookie/`、`data/player/`。
///
/// 所有运行时数据都跟随 exe，便于便携使用（与日志目录策略一致）。
fn data_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or("无法定位 exe 所在目录")?
        .join("data");
    fs::create_dir_all(dir.join("cookie")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("player")).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 从系统凭据库读取 32 字节密钥；不存在则生成并保存。
///
/// 返回 base64 编码的密钥字符串。前端可在启动时调用以触发首次生成，
/// 但实际的加解密命令会自行通过 [`encryption_key`] 取回密钥，密钥不经前端中转。
#[tauri::command]
pub fn get_store_password() -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, KEY_NAME).map_err(|e| e.to_string())?;
    if let Ok(p) = entry.get_password() {
        return Ok(p);
    }
    // 首次启动：生成 32 字节随机密钥
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let password = B64.encode(key);
    entry.set_password(&password).map_err(|e| e.to_string())?;
    Ok(password)
}

/// 返回 `data` 目录绝对路径（同时创建 `data/` 与 `data/cookie/`）。
/// 前端在初始化 store 前调用一次，确保后续写入的父目录都存在。
#[tauri::command]
pub fn get_app_data_dir() -> Result<String, String> {
    Ok(data_dir()?.to_string_lossy().to_string())
}

/// 从系统凭据库取回 32 字节密钥（base64 解码）。
fn encryption_key() -> Result<[u8; 32], String> {
    let entry = Entry::new(SERVICE_NAME, KEY_NAME).map_err(|e| e.to_string())?;
    let pw = entry
        .get_password()
        .map_err(|e| format!("从系统凭据库读取密钥失败：{e}"))?;
    let bytes = B64.decode(pw.as_bytes()).map_err(|e| e.to_string())?;
    if bytes.len() != 32 {
        return Err(format!("密钥长度异常：{} 字节（应为 32）", bytes.len()));
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&bytes);
    Ok(k)
}

/// 用 AES-256-GCM 加密 cookie JSON 字符串，写入 `data/cookie/cookies.dat`。
///
/// 文件格式：`[12 字节 nonce][密文+GCM tag]`。
/// 空字符串表示清除 cookie，此时直接删除文件而非写空密文。
#[tauri::command]
pub fn save_cookies_encrypted(cookies_json: String) -> Result<(), String> {
    let dir = data_dir()?;
    let path = dir.join("cookie").join("cookies.dat");

    // 清除：删除文件即可
    if cookies_json.is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Key, Nonce,
    };
    let key = encryption_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, cookies_json.as_bytes())
        .map_err(|e| format!("AES-GCM 加密失败：{e}"))?;

    let mut out = nonce_bytes.to_vec();
    out.extend_from_slice(&ciphertext);
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(())
}

/// 从 `data/cookie/cookies.dat` 读取并用 AES-256-GCM 解密，返回原始 JSON 字符串。
///
/// 文件不存在时返回 `None`（首次启动 / 未登录）。
#[tauri::command]
pub fn load_cookies_decrypted() -> Result<Option<String>, String> {
    let dir = data_dir()?;
    let path = dir.join("cookie").join("cookies.dat");
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() < 13 {
        return Err("cookie 文件损坏（长度不足）".into());
    }

    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Key, Nonce,
    };
    let key = encryption_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(&data[..12]);
    let plaintext = cipher
        .decrypt(nonce, &data[12..])
        .map_err(|e| format!("AES-GCM 解密失败（密钥不匹配或文件被篡改）：{e}"))?;
    Ok(Some(
        String::from_utf8(plaintext).map_err(|e| e.to_string())?,
    ))
}

/// 同步写入播放列表 JSON 到 `data/playlist.json`（退出前落盘）。
///
/// 使用同步 `fs::write` 而非异步，保证在窗口关闭的极短时间内完成写入。
#[tauri::command]
pub fn save_playlist_json(json: String) -> Result<(), String> {
    let path = data_dir()?.join("playlist.json");
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取 `data/playlist.json`，返回 JSON 字符串；文件不存在返回 `None`。
#[tauri::command]
pub fn load_playlist_json() -> Result<Option<String>, String> {
    let path = data_dir()?.join("playlist.json");
    if !path.exists() {
        return Ok(None);
    }
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(s))
}
