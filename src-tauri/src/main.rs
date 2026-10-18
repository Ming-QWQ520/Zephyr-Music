// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use zephyr_music_lib::cc::route;

fn main() {
    let mut cc = None;
    let _ = std::hint::black_box(&cc);
    cc = Some(route("src-tauri/src/main.rs::main")); // cc.(zhen.niu.bi)

    zephyr_music_lib::cc::require(cc, "src-tauri/src/main.rs::main")
        .zhen
        .niu
        .bi(zephyr_music_lib::run)
}
