//! UKMAC Monitoring's desktop side: opens the local database and Google sign-in, then serves the
//! commands the Angular app calls.
//!
//! - `commands`: every command the frontend calls (`invoke`), grouped by what it works on
//! - `db`: the SQLite file, its schema and the queries the commands share
//! - `services`: Google, the AI connection, `.ukmac` files, the chili template, access
//! - `models`: the data the app and the frontend pass between them
//! - `error`: the result every command returns

mod commands;
mod db;
mod error;
mod models;
mod services;

use std::sync::Mutex;

use tauri::Manager;

/// Where this app keeps its data (what `app_data_dir` says), known before the app exists: the screens of a UI-only update are chosen
/// from here before the window opens.
fn data_folder(identifier: &str) -> Option<std::path::PathBuf> {
    let home = || std::env::var_os("HOME").map(std::path::PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home()?.join("Library").join("Application Support")
    } else if cfg!(windows) {
        std::path::PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(std::path::PathBuf::from).or_else(|| home().map(|home| home.join(".local").join("share")))?
    };
    Some(base.join(identifier))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The screens the window is given: those inside the app, or a newer package kept by a UI-only update (services/ui_update.rs).
    let mut context = tauri::generate_context!();
    let ui_folder = data_folder(&context.config().identifier).unwrap_or_else(|| std::env::temp_dir().join("ukmac-ui")).join("ui");
    let chosen = services::ui_update::choose(&ui_folder, services::ui_update::BINARY, services::ui_update::NATIVE);
    let started_on = chosen.as_ref().map(|active| active.version.clone());
    let layer = services::ui_update::Layer::install(&mut context, chosen);
    tauri::Builder::default()
        .manage(services::ui_update::UiState::new(ui_folder, layer))
        .plugin(tauri_plugin_dialog::init())
        // In-app updates: check the releases page, verify the signature, install, relaunch.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            // Opened on a package of screens: give it a few seconds to start, else go back to the app's own.
            if let Some(version) = started_on.clone() {
                services::ui_update::watch(app.handle(), version);
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // The database: this computer's, in the app's data folder.
            let folder = app.path().app_data_dir()?;
            std::fs::create_dir_all(&folder)?;
            let path = folder.join("ukmac.db");
            let conn = db::open(&path)?;
            // Google sign-in: its client and tokens are kept beside the database, not in it.
            let google = services::google::GoogleState::load(&folder);
            // MACs from before accounts existed go to the account signed in on this computer now.
            if let Some(email) = google.account() {
                services::access::adopt_unowned(&conn, &email)?;
            }
            app.manage(db::Db {
                conn: Mutex::new(conn),
                path,
            });
            app.manage(google);
            // Optional AI connection: keys stay outside the database and its backups.
            app.manage(services::ai::AiState::load(&folder));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::access::unowned_macs,
            commands::access::claim_macs,
            commands::settings::computer_name,
            commands::macs::list_macs,
            commands::macs::create_mac,
            commands::macs::update_mac,
            commands::macs::delete_mac,
            commands::macs::get_workbook,
            commands::macs::get_all_workbooks,
            commands::sheets::create_sheet,
            commands::sheets::update_sheet,
            commands::sheets::save_columns,
            commands::sheets::template_columns,
            commands::sheets::save_dashboard,
            commands::sheets::delete_sheet,
            commands::sheets::reorder_sheets,
            commands::rows::add_rows,
            commands::rows::update_cells,
            commands::rows::reorder_rows,
            commands::rows::delete_rows,
            commands::rows::list_imports,
            commands::rows::undo_import,
            commands::files::read_file,
            commands::files::write_file,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::database_info,
            commands::settings::backup_database,
            commands::mac_file::export_mac_file,
            commands::mac_file::peek_mac_file,
            commands::mac_file::import_mac_file,
            commands::google::google_status,
            commands::google::google_save_client,
            commands::google::google_sign_in,
            commands::google::google_cancel_sign_in,
            commands::google::google_sign_out,
            commands::google::google_list_spreadsheets,
            commands::google::google_file_info,
            commands::google::google_download,
            commands::google::open_link,
            commands::links::list_google_links,
            commands::links::save_google_link,
            commands::links::google_link_synced,
            commands::links::delete_google_link,
            commands::ai::ai_status,
            commands::ai::ai_save_connection,
            commands::ai::ai_test_connection,
            commands::ai::ai_generate_visuals,
            commands::ai::ai_cancel_generation,
            commands::ai::ai_clear_connection,
            commands::ui_update::ui_update_look,
            commands::ui_update::ui_update_install,
            commands::ui_update::ui_update_apply,
            commands::ui_update::ui_booted,
        ])
        .run(context)
        .expect("error while running UKMAC Monitoring");
}
