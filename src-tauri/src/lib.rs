use tauri::Manager;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::{Arc, Mutex};
use chrono::Local;
use lofty::file::AudioFile;

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
        Self { stream: None, sink: None, volume: 0.8, is_playing: false }
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
fn init_log(app: tauri::AppHandle) -> Result<String, String> {
    let d = std::env::current_exe().map_err(|e| e.to_string())?.parent().ok_or("no dir")?.to_path_buf();
    let ld = d.join("log");
    fs::create_dir_all(&ld).map_err(|e| e.to_string())?;
    let ts = Local::now().format("%y%m%d%H%M%S").to_string();
    let lp = ld.join(format!("{}.log", ts));
    let lps = lp.to_string_lossy().to_string();
    fs::write(&lp, format!("=== Zephyr Music Log ===\nStarted: {}\nLog file: {}\n\n", Local::now().format("%Y-%m-%d %H:%M:%S"), lps)).map_err(|e| e.to_string())?;
    *app.state::<LogFile>().0.lock().unwrap() = Some(lps.clone());
    Ok(lps)
}

#[tauri::command]
fn write_log(app: tauri::AppHandle, message: String) -> Result<(), String> { wl(&app, &message); Ok(()) }

#[tauri::command]
fn rodio_play(app: tauri::AppHandle, path: String) -> Result<f64, String> {
    let state = app.state::<Arc<Mutex<AudioState>>>();
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let fp = if path.starts_with("localaudio://") || path.starts_with("localfile://") {
        let raw = path.split(":///").nth(1).unwrap_or(&path);
        urlencoding::decode(raw).map(|s| s.into_owned()).unwrap_or_else(|_| raw.to_string())
    } else { path.clone() };
    wl(&app, &format!("[rodio] opening: {}", fp));
    let file = fs::File::open(&fp).map_err(|e| { wl(&app, &format!("[rodio] open failed: {}", e)); format!("[rodio] open failed: {}", e) })?;

    let source = rodio::Decoder::new(std::io::BufReader::new(file)).map_err(|e| { wl(&app, &format!("[rodio] decode failed: {}", e)); format!("[rodio] decode failed: {}", e) })?;
    wl(&app, "[rodio] decoded ok");
    if let Some(ref sink) = st.sink { sink.stop(); }
    if st.stream.is_none() {
        let (stream, handle) = rodio::OutputStream::try_default().map_err(|e| { wl(&app, &format!("[rodio] stream failed: {}", e)); format!("[rodio] stream failed: {}", e) })?;
        let sink = rodio::Sink::try_new(&handle).map_err(|e| format!("[rodio] sink failed: {}", e))?;
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
        Err(e) => { wl(&app, &format!("[rodio] lofty failed: {}", e)); 0.0 }
    };
    wl(&app, &format!("[rodio] playing, duration={}", dur));
    Ok(dur)
}

#[tauri::command]
fn rodio_pause(app: tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink { sink.pause(); }
    s.is_playing = false;
    wl(&app, "[rodio] paused");
    Ok(())
}

#[tauri::command]
fn rodio_resume(app: tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink { sink.play(); }
    s.is_playing = true;
    wl(&app, "[rodio] resumed");
    Ok(())
}

#[tauri::command]
fn rodio_position(app: tauri::AppHandle) -> Result<f64, String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink { Ok(sink.get_pos().as_secs_f64()) } else { Ok(0.0) }
}

#[tauri::command]
fn rodio_duration(_app: tauri::AppHandle) -> Result<f64, String> { Ok(0.0) }

#[tauri::command]
fn rodio_set_volume(app: tauri::AppHandle, volume: f32) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    s.volume = volume.clamp(0.0, 1.0);
    if let Some(ref sink) = s.sink { sink.set_volume(s.volume); }
    Ok(())
}

#[tauri::command]
fn rodio_is_playing(app: tauri::AppHandle) -> Result<bool, String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        if sink.empty() && s.is_playing { s.is_playing = false; wl(&app, "[rodio] ended"); }
    }
    Ok(s.is_playing)
}

#[tauri::command]
fn rodio_stop(app: tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let mut s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink { sink.stop(); }
    s.is_playing = false;
    wl(&app, "[rodio] stopped");
    Ok(())
}

#[tauri::command]
fn rodio_seek(app: tauri::AppHandle, position: f64) -> Result<(), String> {
    let st = app.state::<Arc<Mutex<AudioState>>>();
    let s = st.lock().map_err(|e| e.to_string())?;
    if let Some(ref sink) = s.sink {
        sink.try_seek(std::time::Duration::from_secs_f64(position)).map_err(|e| format!("[rodio] seek failed: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(LogFile(Mutex::new(None)))
        .manage(Arc::new(Mutex::new(AudioState::new())))
        .invoke_handler(tauri::generate_handler![
            init_log, write_log,
            rodio_play, rodio_pause, rodio_resume,
            rodio_position, rodio_duration,
            rodio_set_volume, rodio_is_playing, rodio_stop, rodio_seek
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            { if let Some(win) = app.get_webview_window("main") { win.open_devtools(); } }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
