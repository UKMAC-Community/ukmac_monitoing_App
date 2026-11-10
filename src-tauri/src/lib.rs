mod ai;
mod client_seal;
mod commands;
mod db;
mod google;
mod links;
mod macfile;
mod model;
mod template;

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
            app.manage(commands::Db {
                conn: Mutex::new(conn),
                path,
            });
            // Google sign-in: its client and tokens are kept beside the database, not in it.
            app.manage(google::GoogleState::load(&folder));
            // Optional AI connection: keys stay outside the database and its backups.
            app.manage(ai::AiState::load(&folder));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_macs,
            commands::create_mac,
            commands::update_mac,
            commands::delete_mac,
            commands::get_workbook,
            commands::get_all_workbooks,
            commands::create_sheet,
            commands::update_sheet,
            commands::save_columns,
            commands::template_columns,
            commands::save_dashboard,
            commands::delete_sheet,
            commands::reorder_sheets,
            commands::add_rows,
            commands::update_cells,
            commands::reorder_rows,
            commands::delete_rows,
            commands::list_imports,
            commands::undo_import,
            commands::read_file,
            commands::write_file,
            commands::get_setting,
            commands::set_setting,
            commands::database_info,
            commands::backup_database,
            macfile::export_mac_file,
            macfile::peek_mac_file,
            macfile::import_mac_file,
            google::google_status,
            google::google_save_client,
            google::google_sign_in,
            google::google_cancel_sign_in,
            google::google_sign_out,
            google::google_list_spreadsheets,
            google::google_file_info,
            google::google_download,
            google::open_link,
            links::list_google_links,
            links::save_google_link,
            links::google_link_synced,
            links::delete_google_link,
            ai::ai_status,
            ai::ai_save_connection,
            ai::ai_test_connection,
            ai::ai_generate_visuals,
            ai::ai_cancel_generation,
            ai::ai_clear_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running UKMAC Monitoring");
}
