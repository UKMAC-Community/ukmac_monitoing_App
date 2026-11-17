//! This computer's name, the app's settings, and the database file itself (where it is, a backup).

use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::{CmdResult, err};
use crate::services::access;
use crate::services::google::GoogleState;

/// The name this computer has (System Settings › General › About › Name, e.g. "Chesthara's MacBook Air"), for the sidebar's foot.
/// Empty when it can't be read.
#[tauri::command]
pub fn computer_name() -> String {
    let said = |program: &str, args: &[&str]| {
        std::process::Command::new(program)
            .args(args)
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|name| !name.is_empty())
    };
    said("scutil", &["--get", "ComputerName"])
        .or_else(|| said("hostname", &[]))
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> CmdResult<Option<String>> {
    let conn = db.conn.lock().map_err(err)?;
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(err)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: Option<String>) -> CmdResult<()> {
    let conn = db.conn.lock().map_err(err)?;
    match value {
        Some(value) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        ),
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [key]),
    }
    .map_err(err)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    path: String,
    size_bytes: u64,
}

#[tauri::command]
pub fn database_info(db: State<'_, Db>) -> CmdResult<DatabaseInfo> {
    let size_bytes = std::fs::metadata(&db.path).map(|m| m.len()).unwrap_or(0);
    Ok(DatabaseInfo {
        path: db.path.display().to_string(),
        size_bytes,
    })
}

/// A copy of the whole database, safe to take while the app runs.
#[tauri::command]
pub fn backup_database(db: State<'_, Db>, google: State<'_, GoogleState>, path: String) -> CmdResult<()> {
    let email = access::require(&google)?;
    {
        let conn = db.conn.lock().map_err(err)?;
        if access::others_exist(&conn, &email)? {
            return Err("This computer also holds MACs of other Google accounts, and a backup is a copy of the whole database, so it would copy their data. Sign in with the account that owns this computer's data, or remove the other MACs first.".into());
        }
    }
    if std::path::Path::new(&path).exists() {
        std::fs::remove_file(&path).map_err(err)?;
    }
    let conn = db.conn.lock().map_err(err)?;
    conn.execute("VACUUM INTO ?1", [path]).map_err(err)?;
    Ok(())
}
