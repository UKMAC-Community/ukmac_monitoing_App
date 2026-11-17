//! A MAC saved to a `.ukmac` file and opened from one.

use tauri::State;

use crate::db::Db;
use crate::error::{CmdResult, err};
use crate::services::mac_file::{
    build, import_as, Imported, Peek, peek, read, Saved, unlinked_with_rows,
};

/// Writes a MAC's tables and their Google links, with no rows, to `path`.
#[tauri::command]
pub fn export_mac_file(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    mac_id: i64,
    path: String,
) -> CmdResult<Saved> {
    let (file, empty_on_open) = {
        let conn = db.conn.lock().map_err(err)?;
        crate::services::access::guard_mac(&conn, &google, mac_id)?;
        (build(&conn, mac_id)?, unlinked_with_rows(&conn, mac_id)?)
    };
    let bytes = serde_json::to_vec(&file).map_err(err)?;
    // Written beside it first, so a failure never leaves half a file where the old one was.
    let part = format!("{path}.part");
    std::fs::write(&part, &bytes).map_err(err)?;
    if let Err(error) = std::fs::rename(&part, &path) {
        let _ = std::fs::remove_file(&part);
        return Err(err(error));
    }
    Ok(Saved {
        sheets: file.sheets.len(),
        rows: file.sheets.iter().map(|sheet| sheet.rows.len()).sum(),
        bytes: bytes.len() as u64,
        linked: file.sheets.iter().filter(|sheet| sheet.google_link.is_some()).count(),
        empty_on_open,
    })
}

/// Reads a MAC file's header: what it holds, and whether this computer already has that MAC.
#[tauri::command]
pub fn peek_mac_file(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    path: String,
) -> CmdResult<Peek> {
    let email = crate::services::access::require(&google)?;
    let file = read(&path)?;
    let conn = db.conn.lock().map_err(err)?;
    peek(&conn, &file, Some(&email))
}

/// Adds the MAC in the file (see `import`).
#[tauri::command]
pub fn import_mac_file(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    path: String,
    replace: bool,
) -> CmdResult<Imported> {
    let email = crate::services::access::require(&google)?;
    let file = read(&path)?;
    let mut conn = db.conn.lock().map_err(err)?;
    import_as(&mut conn, file, replace, Some(&email))
}
