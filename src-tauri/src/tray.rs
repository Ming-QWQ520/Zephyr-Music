//! 系统托盘模块
//!
//! 提供：
//!   1. 启动时创建托盘图标（使用应用默认 icon，不做动态封面替换）
//!   2. 左键单击托盘 → 切换主窗口可见性
//!   3. 右键单击托盘 → 在鼠标位置附近显示 tray-popup 弹出窗口
//!      （弹出窗口内渲染当前歌曲封面 + 歌名 + 歌手 + 播放控制）
//!   4. `update_tray_tooltip` 命令：前端切歌时调用，更新托盘 tooltip（歌名 - 歌手）
//!   5. `consume_quit_flag` 命令：检查退出标记（托盘无右键菜单了，此命令保留供设置中"直接退出"使用）
//!
//! 跨平台行为：
//!   - Windows / macOS：tooltip 单行显示，左键切换窗口，右键弹出自定义 popup
//!   - Linux：右键事件可能不触发（tray-icon crate 限制），但左键功能可用

use std::sync::Mutex;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime,
};

/// 托盘 ID
const TRAY_ID: &str = "zephyr-main-tray";

/// tray-popup 窗口的标签（必须与 tauri.conf.json 中定义一致）
const POPUP_LABEL: &str = "tray-popup";

/// tray-popup 窗口尺寸（与 tauri.conf.json 一致，用于定位计算）
const POPUP_WIDTH: f64 = 240.0;
const POPUP_HEIGHT: f64 = 200.0;

/// 当前是否处于"已退出"标记（防止退出流程被 onCloseRequested 拦截后再次进入）
struct QuitRequested(Mutex<bool>);

impl QuitRequested {
    fn new() -> Self {
        Self(Mutex::new(false))
    }
    fn take(&self) -> bool {
        if let Ok(mut g) = self.0.lock() {
            let v = *g;
            *g = false;
            v
        } else {
            false
        }
    }
    fn set(&self) {
        if let Ok(mut g) = self.0.lock() {
            *g = true;
        }
    }
}

/// 创建托盘：在 setup() 中调用一次。
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // 已存在则跳过（HMR / 重复调用安全）
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }

    // 使用应用默认图标作为托盘图标（不做动态封面替换）
    let icon = app.default_window_icon().cloned().unwrap_or_else(|| {
        Image::new(&[], 0, 0)
    });

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Zephyr · 音乐")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                // 左键单击：切换主窗口可见性
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => {
                    toggle_main_window(app);
                    let _ = position; // 左键不使用位置
                }
                // 右键单击：在鼠标位置附近显示 tray-popup 弹出窗口
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => {
                    show_tray_popup(app, position);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// 切换主窗口可见性（托盘左键点击）
fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
}

/// 在鼠标点击位置附近显示 tray-popup 弹出窗口
///
/// 定位策略：
///   - 以鼠标点击位置为基准，popup 显示在点击位置的右下方
///   - 如果右下方超出屏幕边界，则翻转到左上方
///   - 使用 work_area（排除任务栏）确保 popup 不被遮挡
fn show_tray_popup<R: Runtime>(app: &AppHandle<R>, click_pos: PhysicalPosition<f64>) {
    let popup = match app.get_webview_window(POPUP_LABEL) {
        Some(w) => w,
        None => {
            eprintln!("[tray] tray-popup window not found");
            return;
        }
    };

    // 获取点击位置所在显示器，计算 popup 位置
    let (target_x, target_y) = compute_popup_position(app, click_pos);

    // 设置位置 → 显示 → 聚焦
    // set_position 接收 Into<Position>，PhysicalPosition<f64> 可通过 From 转换
    let pos = PhysicalPosition::new(target_x as i32, target_y as i32);
    if let Err(e) = popup.set_position(pos) {
        eprintln!("[tray] set_popup_position failed: {}", e);
    }
    let _ = popup.show();
    let _ = popup.set_focus();

    // 通知前端 popup 已打开（前端可在此事件后请求最新播放状态）
    let _ = app.emit("tray-popup-shown", ());
}

/// 计算 popup 窗口的目标位置（物理像素）
fn compute_popup_position<R: Runtime>(
    app: &AppHandle<R>,
    click_pos: PhysicalPosition<f64>,
) -> (f64, f64) {
    let click_x = click_pos.x;
    let click_y = click_pos.y;

    // 默认：popup 显示在点击位置右下方
    let mut target_x = click_x + 8.0;
    let mut target_y = click_y + 8.0;

    // 尝试获取点击位置所在显示器的工作区域，避免 popup 超出屏幕
    if let Ok(Some(monitor)) = app.monitor_from_point(click_x, click_y) {
        let work_area = monitor.work_area();
        let screen_x = work_area.position.x as f64;
        let screen_y = work_area.position.y as f64;
        let screen_w = work_area.size.width as f64;
        let screen_h = work_area.size.height as f64;

        // 右侧超出 → 翻转到左侧
        if target_x + POPUP_WIDTH > screen_x + screen_w {
            target_x = click_x - POPUP_WIDTH - 8.0;
        }
        // 下方超出 → 翻转到上方
        if target_y + POPUP_HEIGHT > screen_y + screen_h {
            target_y = click_y - POPUP_HEIGHT - 8.0;
        }
        // 确保不小于屏幕左上角
        if target_x < screen_x {
            target_x = screen_x;
        }
        if target_y < screen_y {
            target_y = screen_y;
        }
    }

    (target_x, target_y)
}

/// 隐藏 tray-popup 窗口（前端在失焦时调用）
#[tauri::command]
pub fn hide_tray_popup(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        win.hide().map_err(|e| format!("hide popup failed: {}", e))?;
    }
    Ok(())
}

/// 完全退出应用：移除托盘图标 → 隐藏 popup → 退出进程。
/// 用于"退出后动作=直接退出"场景，确保托盘图标不残留。
#[tauri::command]
pub fn quit_app(app: AppHandle) -> Result<(), String> {
    // 移除托盘图标（防止进程退出后托盘残留）
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
    // 隐藏 popup（如果可见）
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        let _ = popup.hide();
    }
    // 退出进程
    app.exit(0);
    Ok(())
}

/// 触发退出流程：设置退出标记 → 关闭主窗口 → 触发 onCloseRequested
/// onCloseRequested 处理器会检测到退出标记，跳过"最小化到托盘"逻辑直接退出
///
/// 当前未被调用（托盘原生菜单已移除），保留供未来可能的"退出"入口使用。
#[allow(dead_code)]
pub fn trigger_quit<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<QuitRequested>() {
        state.set();
    }
    // 隐藏 popup（如果可见）
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        let _ = popup.hide();
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    } else {
        app.exit(0);
    }
}

/// 检查并消费"退出标记"（由前端 onCloseRequested 处理器调用）
#[tauri::command]
pub fn consume_quit_flag(app: AppHandle) -> Result<bool, String> {
    if let Some(state) = app.try_state::<QuitRequested>() {
        Ok(state.take())
    } else {
        Ok(false)
    }
}

/// 更新托盘 tooltip（仅 tooltip，不更新图标）
///
/// - `tooltip`: 形如 "▶ 歌名 - 歌手" 的字符串
#[tauri::command]
pub fn update_tray_tooltip(app: AppHandle, tooltip: String) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "托盘未初始化".to_string())?;

    if !tooltip.is_empty() {
        tray.set_tooltip(Some(&tooltip))
            .map_err(|e| format!("set_tooltip failed: {}", e))?;
    }

    Ok(())
}

/// 注册 QuitRequested 状态（在 setup 中调用）
pub fn register_quit_state<R: Runtime>(app: &AppHandle<R>) {
    app.manage(QuitRequested::new());
}
