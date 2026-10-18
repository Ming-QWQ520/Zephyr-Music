//! 本地持久化模块
//!
//! 负责以下数据的存储（全部位于 exe 同级 `data/` 目录，便携迁移）：
//!   1. 通用设置 (`data/settings.json`)              — 明文 JSON（首页设置、云盘记录等）
//!   2. 播放器设置 (`data/player_settings.json`)    — 明文 JSON（rnp-settings）
//!   3. Cookie (`data/cookie/cookies.txt`)           — 明文存储
//!   4. 播放列表 (`data/playlist/playlist.json`)    — 明文 JSON（退出前落盘）
//!   5. 壁纸图片 (`data/wallpaper/`)                 — 用户选择的本地图片副本
//!
//! 所有命令使用同步 `fs::write` / `fs::read_to_string`，保证窗口关闭瞬间也能完成写入。

use std::fs;
use std::path::PathBuf;
use chrono::Local;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const MAX_COOKIE_BYTES: usize = 128 * 1024;

/// 返回 exe 所在目录的绝对路径。
fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent().ok_or("无法定位 exe 所在目录".into()).map(|p| p.to_path_buf())
}

/// 返回 exe 所在目录下的 `data` 目录，并确保所有子目录存在：
/// `data/`、`data/cookie/`、`data/playlist/`、`data/wallpaper/`。
fn data_dir() -> Result<PathBuf, String> {
    let dir = exe_dir()?.join("data");
    fs::create_dir_all(dir.join("cookie")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("playlist")).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 返回 exe 所在目录的绝对路径（供前端构建 CloudDownload 等路径）。
#[tauri::command]
pub fn get_exe_dir() -> Result<String, String> {
    Ok(exe_dir()?.to_string_lossy().to_string())
}

/// 返回 `data` 目录绝对路径（同时创建所有子目录）。
#[tauri::command]
pub fn get_app_data_dir() -> Result<String, String> {
    Ok(data_dir()?.to_string_lossy().to_string())
}

// ===== Cookie =====

fn cleanup_legacy_cookie(dir: &std::path::Path) {
    let legacy = dir.join("cookie").join("cookies.dat");
    if legacy.exists() {
        let _ = fs::remove_file(legacy);
    }
}

#[tauri::command]
pub fn save_cookies(cookies: String) -> Result<(), String> {
    let dir = data_dir()?;
    cleanup_legacy_cookie(&dir);
    let path = dir.join("cookie").join("cookies.txt");
    if cookies.is_empty() {
        if path.exists() { fs::remove_file(&path).map_err(|e| e.to_string())?; }
        return Ok(());
    }
    if cookies.len() > MAX_COOKIE_BYTES {
        return Err("Cookie 数据异常：大小超过 128 KiB".to_string());
    }
    fs::write(&path, cookies).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_cookies() -> Result<Option<String>, String> {
    let dir = data_dir()?;
    cleanup_legacy_cookie(&dir);
    let path = dir.join("cookie").join("cookies.txt");
    if !path.exists() { return Ok(None); }
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_COOKIE_BYTES as u64 {
        return Err("Cookie 文件异常：大小超过 128 KiB".to_string());
    }
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(s))
}

// ===== 通用设置 (data/settings.json) =====

#[tauri::command]
pub fn save_settings_json(json: String) -> Result<(), String> {
    let path = data_dir()?.join("settings.json");
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_settings_json() -> Result<Option<String>, String> {
    let path = data_dir()?.join("settings.json");
    if !path.exists() { return Ok(None); }
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(s))
}

// ===== 播放器设置 (data/player_settings.json) =====

#[tauri::command]
pub fn save_player_settings_json(json: String) -> Result<(), String> {
    let path = data_dir()?.join("player_settings.json");
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_player_settings_json() -> Result<Option<String>, String> {
    let path = data_dir()?.join("player_settings.json");
    if !path.exists() { return Ok(None); }
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(s))
}

// ===== 播放列表 (data/playlist/playlist.json) =====

#[tauri::command]
pub fn save_playlist_json(json: String) -> Result<(), String> {
    let path = data_dir()?.join("playlist").join("playlist.json");
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_playlist_json() -> Result<Option<String>, String> {
    let path = data_dir()?.join("playlist").join("playlist.json");
    if !path.exists() { return Ok(None); }
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(s))
}

// ===== 壁纸图片 (data/wallpaper/) =====

fn wallpaper_dir() -> Result<PathBuf, String> {
    let dir = data_dir()?.join("wallpaper");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn save_wallpaper_image(source_path: String, suggested_name: Option<String>) -> Result<String, String> {
    let src = std::path::Path::new(&source_path);
    if !src.exists() {
        return Err(format!("源文件不存在: {}", source_path));
    }
    let ext = suggested_name
        .as_deref()
        .and_then(|n| std::path::Path::new(n).extension())
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .or_else(|| src.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "jpg".to_string());

    const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "avif"];
    let ext = if ALLOWED.contains(&ext.as_str()) { ext } else { "jpg".to_string() };

    let dir = wallpaper_dir()?;
    let ts = Local::now().format("%Y%m%d%H%M%S").to_string();
    let pid = std::process::id();
    let filename = format!("wallpaper-{}-{}.{}", ts, pid, ext);
    let dest = dir.join(&filename);
    fs::copy(src, &dest).map_err(|e| format!("复制文件失败: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_wallpaper_image(file_path: String) -> Result<(), String> {
    if file_path.is_empty() { return Ok(()); }
    let dir = wallpaper_dir()?;
    let p = std::path::Path::new(&file_path);
    let target = if p.is_absolute() { p.to_path_buf() } else { dir.join(&file_path) };
    let dir_canon = dir.canonicalize().map_err(|e| format!("无法访问壁纸目录: {}", e))?;
    let target_canon = match target.canonicalize() {
        Ok(c) => c,
        Err(_) => { return Ok(()); }
    };
    if !target_canon.starts_with(&dir_canon) {
        return Err("拒绝删除：路径不在壁纸目录内".to_string());
    }
    if target_canon.exists() {
        fs::remove_file(&target_canon).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_wallpaper_images() -> Result<Vec<String>, String> {
    let dir = wallpaper_dir()?;
    let mut list = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() { list.push(p.to_string_lossy().to_string()); }
        }
    }
    Ok(list)
}

// ===== 通用文件写入（用于云盘下载） =====

#[tauri::command]
pub fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(p, &data).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 追加写入二进制数据到文件末尾（用于流式下载，避免内存中缓存整个文件）。
///
/// 第一次调用时创建文件（truncate），后续调用追加到末尾。
/// - `path`: 目标文件绝对路径
/// - `data`: 本次要追加的字节
/// - `truncate`: 是否清空文件重新开始（首次调用传 true）
#[tauri::command]
pub fn append_binary_file(path: String, data: Vec<u8>, truncate: bool) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    use std::io::Write;
    let mut file = if truncate {
        // 创建/截断文件
        fs::File::create(p).map_err(|e| format!("创建文件失败: {}", e))?
    } else {
        // 追加模式打开（文件不存在则创建）
        fs::OpenOptions::new().create(true).append(true).open(p).map_err(|e| format!("打开文件失败: {}", e))?
    };
    file.write_all(&data).map_err(|e| format!("写入文件失败: {}", e))?;
    file.flush().map_err(|e| format!("flush 失败: {}", e))?;
    Ok(())
}

/// 在文件管理器中显示文件（选中文件，而非打开文件）。
#[tauri::command]
pub fn open_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("打开 Finder 失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {}", e))?;
    }

    Ok(())
}

/// Rust 端流式下载文件到磁盘（避免前端 IPC 传输大块数据的开销）。
///
/// 使用 reqwest 直接 GET URL，流式写入文件，通过 Tauri 事件实时报告进度。
/// 前端通过 listen("download-progress-<id>", ...) 接收进度更新。
///
/// 参数：
/// - `url`: 下载地址
/// - `filepath`: 目标文件路径
/// - `task_id`: 任务 ID（用于事件名，前端据此监听）
///
/// 返回：文件大小（字节）
#[tauri::command]
pub async fn download_file_stream(
    app: tauri::AppHandle,
    url: String,
    filepath: String,
    task_id: String,
) -> Result<u64, String> {
    use std::io::Write;
    use tauri::Emitter;

    // 创建父目录
    let p = std::path::Path::new(&filepath);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    // 发起请求
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);

    // 创建文件
    let mut file = fs::File::create(p).map_err(|e| format!("创建文件失败: {}", e))?;

    // 流式读取并写入
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut loaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取失败: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("写入失败: {}", e))?;
        loaded += chunk.len() as u64;

        // 每 250ms 发送一次进度事件（避免事件过频）
        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 250 {
            let _ = app.emit(
                &format!("download-progress-{}", task_id),
                serde_json::json!({
                    "loaded": loaded,
                    "total": total,
                }),
            );
            last_emit = now;
        }
    }

    file.flush().map_err(|e| format!("flush 失败: {}", e))?;

    // 最终进度
    let _ = app.emit(
        &format!("download-progress-{}", task_id),
        serde_json::json!({
            "loaded": loaded,
            "total": total,
            "done": true,
        }),
    );

    Ok(loaded)
}

/// 获取文件大小（字节），用于上传前显示和 API 参数。
/// 独立命令避免 plugin-fs 的 stat() 权限限制。
#[tauri::command]
pub fn get_file_size(filepath: String) -> Result<u64, String> {
    let p = std::path::Path::new(&filepath);
    if !p.exists() {
        return Err(format!("文件不存在: {}", filepath));
    }
    let meta = fs::metadata(p).map_err(|e| format!("读取文件信息失败: {}", e))?;
    Ok(meta.len())
}

/// 计算文件的 MD5 哈希值（用于云盘上传去重）。
///
/// 使用分块读取避免大文件 OOM，每块 2MB。
/// 通过 Tauri 事件报告进度（事件名：md5-progress-<task_id>）。
///
/// 返回：32 字符小写 hex 字符串
#[tauri::command]
pub async fn compute_file_md5(
    app: tauri::AppHandle,
    filepath: String,
    task_id: String,
) -> Result<String, String> {
    use tauri::Emitter;
    use md5::{Md5, Digest};
    let p = std::path::Path::new(&filepath);
    if !p.exists() {
        return Err(format!("文件不存在: {}", filepath));
    }

    let file_size = fs::metadata(p).map_err(|e| format!("读取文件信息失败: {}", e))?.len();
    let mut file = tokio::fs::File::open(p).await.map_err(|e| format!("打开文件失败: {}", e))?;

    use tokio::io::AsyncReadExt;
    let mut hasher = Md5::new();
    let mut buffer = vec![0u8; 2 * 1024 * 1024]; // 2MB buffer
    let mut loaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = file.read(&mut buffer).await.map_err(|e| format!("读取失败: {}", e))?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
        loaded += n as u64;

        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 250 {
            let _ = app.emit(
                &format!("md5-progress-{}", task_id),
                serde_json::json!({
                    "loaded": loaded,
                    "total": file_size,
                }),
            );
            last_emit = now;
        }
    }

    let result = hasher.finalize();
    let hex: String = result.iter().map(|b| format!("{:02x}", b)).collect();
    Ok(hex)
}

/// Rust 端上传文件到云存储（避免前端 XHR 的 CORS 限制）。
///
/// 网易云的直传 URL（nosup-hz1.127.net）不支持 CORS，前端 XHR PUT 会返回 status:0。
/// 改用 Rust reqwest 发起 PUT 请求，不受 CORS 限制。
///
/// 参数：
/// - `url`: 上传目标 URL
/// - `filepath`: 本地文件路径
/// - `task_id`: 任务 ID（用于事件名，前端据此监听进度）
///
/// 返回：是否成功
#[tauri::command]
pub async fn upload_file_stream(
    app: tauri::AppHandle,
    url: String,
    filepath: String,
    task_id: String,
) -> Result<bool, String> {
    use tauri::Emitter;

    // 读取文件
    let p = std::path::Path::new(&filepath);
    if !p.exists() {
        return Err(format!("文件不存在: {}", filepath));
    }
    let file_size = fs::metadata(p).map_err(|e| format!("读取文件信息失败: {}", e))?.len();

    // 用 tokio::fs 异步读取文件
    let file = tokio::fs::File::open(p).await.map_err(|e| format!("打开文件失败: {}", e))?;

    // 创建带进度追踪的 Reader
    use tokio::io::AsyncReadExt;
    let mut reader = file;

    // 分块读取并上传（reqwest 的 body 不直接支持进度回调，用 stream 方式）
    // 先读取整个文件到内存（音乐文件通常 <20MB，可接受）
    let mut buffer = Vec::with_capacity(file_size as usize);
    reader.read_to_end(&mut buffer).await.map_err(|e| format!("读取文件失败: {}", e))?;

    // 用 reqwest 上传
    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Content-Type", "audio/mpeg")
        .body(buffer)
        .send()
        .await
        .map_err(|e| format!("上传请求失败: {}", e))?;

    let status = response.status();
    let ok = status.is_success() || status.as_u16() == 204;

    // 发送完成事件
    let _ = app.emit(
        &format!("upload-progress-{}", task_id),
        serde_json::json!({
            "loaded": file_size,
            "total": file_size,
            "done": true,
            "ok": ok,
        }),
    );

    if !ok {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("上传失败: HTTP {} {}", status, body));
    }

    Ok(true)
}
