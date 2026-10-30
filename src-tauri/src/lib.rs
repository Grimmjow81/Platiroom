use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

// Portable layout: data (json/ and img/cache/) lives next to the executable.
// In debug builds (tauri dev) the project root is used instead, so the real project files are edited.
fn portable_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_default()
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

#[tauri::command]
fn data_dir() -> String {
    portable_dir().to_string_lossy().into_owned()
}

// All the app logic lives in the webview (JavaScript); Rust only registers the plugins and the data folder.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![data_dir])
        .setup(|app| {
            let dir = portable_dir();
            let cache = dir.join("img").join("cache");
            std::fs::create_dir_all(dir.join("json"))?;
            std::fs::create_dir_all(&cache)?;

            // The data folder is only known at runtime, so the scopes are opened here
            app.fs_scope().allow_directory(&dir, true)?;
            app.asset_protocol_scope().allow_directory(&cache, true)?;
			if let Some(window) = app.get_webview_window("main") {
				let _ = window.maximize();
			}
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Platiroom");
}
