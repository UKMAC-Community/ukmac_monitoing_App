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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // In-app updates: check the releases page, verify the signature, install, relaunch.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running UKMAC Monitoring");
}
