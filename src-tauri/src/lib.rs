use chrono::Local;
use lofty::file::AudioFile;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::Manager;

mod netease_report;

struct LogFile(Mutex<Option<String>>);

// OutputStream and Sink contain raw pointers that aren't Send.
// We wrap them to make them Send so Tauri can manage them as State.
struct AudioState {
    stream: Option<rodio::OutputStream>,
    sink: Option<rodio::Sink>,
    volume: f32,
    is_playing: bool,
}
impl AudioState {
    fn new() -> Self {
        Self {
            stream: None,
            sink: None,
            volume: 0.8,
            is_playing: false,
        }
    }
}
unsafe impl Send for AudioState {}

fn wl(app: &tauri::AppHandle, msg: &str) {
    let st = app.state::<LogFile>();
    let guard = st.0.lock();
    if let Ok(g) = guard {
        if let Some(p) = g.as_ref() {
            let ts = Local::now().format("%H:%M:%S%.3f").to_string();
            if let Ok(mut f) = OpenOptions::new().append(true).open(p) {
                let _ = f.write_all(format!("[{}] {}\n", ts, msg).as_bytes());
                let _ = f.flush();
            }
        }
    }
}

#[tauri::command]
fn init_log(_app: tauri::AppHandle) -> Result<String, String> {
    // 日志目录：exe 所在目录下的 log 子目录
    // 这样所有运行时数据都跟随 exe，便于便携使用
    let ld = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("no dir")?
        .to_path_buf();
    let ld = ld.join("log");
    fs::create_dir_all(&ld).map_err(|e| e.to_string())?;

    // 日志轮转：清理超 5MB 的旧日志，最多保留 5 个。
    // 注：当前进程刚启动，新日志文件尚未创建，因此无需排除任何文件。
    if let Ok(entries) = fs::read_dir(&ld) {
        let mut logs: Vec<(std::path::PathBuf, std::time::SystemTime, u64)> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) != Some("log") {
                    return None;
                }
                let meta = fs::metadata(&p).ok()?;
                let size = meta.len();
                // 修改时间，无法获取则用 UNIX_EPOCH
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                Some((p, mtime, size))
            })
            .collect();
        // 按修改时间倒序（最新的在前）
        logs.sort_by(|a, b| b.1.cmp(&a.1));
        // 删除超过 5MB 的旧日志
        for (p, _, size) in &logs {
            if *size > 5 * 1024 * 1024 {
                let _ = fs::remove_file(p);
            }
        }
        // 最多保留 5 个（按时间排序后，跳过前 5 个，删除其余）
        // 重新读取一次列表，因为上一步可能已经删除了一些
        if let Ok(entries2) = fs::read_dir(&ld) {
            let mut remaining: Vec<(std::path::PathBuf, std::time::SystemTime)> = entries2
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    if p.extension().and_then(|s| s.to_str()) != Some("log") {
                        return None;
                    }
                    let meta = fs::metadata(&p).ok()?;
                    let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                    Some((p, mtime))
                })
                .collect();
            remaining.sort_by(|a, b| b.1.cmp(&a.1));
            for (p, _) in remaining.into_iter().skip(5) {
                let _ = fs::remove_file(p);
            }
        }
    }

    let ts = Local::now().format("%y%m%d%H%M%S").to_string();
    let lp = ld.join(format!("{}.log", ts));
    let lps = lp.to_string_lossy().to_string();
    fs::write(
        &lp,
        format!(
            "=== Zephyr Music Log ===\nStarted: {}\nLog file: {}\n\n",
            Local::now().format("%Y-%m-%d %H:%M:%S"),
            lps
        ),
    )
    .map_err(|e| e.to_string())?;
    // 优雅处理 Mutex poison：避免在异常情况下 panic 整个进程
    if let Ok(mut guard) = _app.state::<LogFile>().0.lock() {
        *guard = Some(lps.clone());
    }
    Ok(lps)
}

#[tauri::command]
fn write_log(app: tauri::AppHandle, message: String) -> Result<(), String> {
    wl(&app, &message);
    Ok(())
}

#[tauri::command]
fn rodio_play(app: tauri::AppHandle, path: String) -> Result<f64, String> {
    let state = app.state::<Arc<Mutex<AudioState>>>();
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let fp = if path.starts_with("localaudio://") || path.starts_with("localfile://") {
        let raw = path.split(":///").nth(1).unwrap_or(&path);
        urlencoding::decode(raw)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| raw.to_string())
    } else {
        path.clone()
    };
    wl(&app, &format!("[rodio] opening: {}", fp));
    let file = fs::File::open(&fp).map_err(|e| {
        wl(&app, &format!("[rodio] open failed: {}", e));
        format!("[rodio] open failed: {}", e)
    })?;

    let source = rodio::Decoder::new(std::io::BufReader::new(file)).map_err(|e| {
        wl(&app, &format!("[rodio] decode failed: {}", e));
        format!("[rodio] decode failed: {}", e)
    })?;
    wl(&app, "[rodio] decoded ok");
    if let Some(ref sink) = st.sink {
        sink.stop();
    }
    if st.stream.is_none() {
        let (stream, handle) = rodio::OutputStream::try_default().map_err(|e| {
            wl(&app, &format!("[rodio] stream failed: {}", e));
            format!("[rodio] stream failed: {}", e)
        })?;
        let sink =
            rodio::Sink::try_new(&handle).map_err(|e| format!("[rodio] sink failed: {}", e))?;
        st.stream = Some(stream);
        st.sink = Some(sink);
    }
    if let Some(ref sink) = st.sink {
        sink.set_volume(st.volume);
        sink.append(source);
        st.is_playing = true;
    }
    // Get duration from file metadata via lofty
    let dur = match lofty::read_from_path(&fp) {
        Ok(tf) => {
            let d = tf.properties().duration().as_secs_f64();
            wl(&app, &format!("[rodio] duration: {}s", d));
            d
        }
        Err(e) => {
            wl(&app, &format!("[rodio] lofty failed: {}", e));
            0.0
        }
    };
    wl(&app, &format!("[rodio] playing, duration={}", dur));
    Ok(dur)
}

#[tauri::command]
fn rodio_pause(app: tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        sink.pause();
    }
    s.is_playing = false;
    wl(&app, "[rodio] paused");
    Ok(())
}

#[tauri::command]
fn rodio_resume(app: tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        sink.play();
    }
    s.is_playing = true;
    wl(&app, "[rodio] resumed");
    Ok(())
}

#[tauri::command]
fn rodio_position(app: tauri::AppHandle) -> Result<f64, String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        Ok(sink.get_pos().as_secs_f64())
    } else {
        Ok(0.0)
    }
}

#[tauri::command]
fn rodio_set_volume(app: tauri::AppHandle, volume: f32) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    s.volume = volume.clamp(0.0, 1.0);
    if let Some(ref sink) = s.sink {
        sink.set_volume(s.volume);
    }
    Ok(())
}

#[tauri::command]
fn rodio_is_playing(app: tauri::AppHandle) -> Result<bool, String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        if sink.empty() && s.is_playing {
            s.is_playing = false;
            wl(&app, "[rodio] ended");
        }
    }
    Ok(s.is_playing)
}

#[tauri::command]
fn rodio_stop(app: tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        sink.stop();
    }
    s.is_playing = false;
    wl(&app, "[rodio] stopped");
    Ok(())
}

#[tauri::command]
fn rodio_seek(app: tauri::AppHandle, position: f64) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        sink.try_seek(std::time::Duration::from_secs_f64(position))
            .map_err(|e| format!("[rodio] seek failed: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(LogFile(Mutex::new(None)))
        .manage(Arc::new(Mutex::new(AudioState::new())))
        .invoke_handler(tauri::generate_handler![
            init_log,
            write_log,
            rodio_play,
            rodio_pause,
            rodio_resume,
            rodio_position,
            rodio_set_volume,
            rodio_is_playing,
            rodio_stop,
            rodio_seek,
            netease_report::netease_report_playback
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
