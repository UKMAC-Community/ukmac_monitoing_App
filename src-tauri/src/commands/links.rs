//! Which table reads which tab of a Google Sheet.

use serde_json::{Map, Value};
use tauri::State;

use crate::db::Db;
use crate::error::{CmdResult, err};
use crate::services::links::{GoogleLink, GoogleLinkInput, list, remove, save, synced};

/// Only the signed-in account's own MACs' links (the others' sheet and table names stay unseen).
#[tauri::command]
pub fn list_google_links(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    mac_id: Option<i64>,
) -> CmdResult<Vec<GoogleLink>> {
    let Some(email) = google.account() else {
        return Ok(Vec::new());
    };
    let conn = db.conn.lock().map_err(err)?;
    let owned = crate::services::access::owned(&conn, &email)?;
    Ok(list(&conn, mac_id)?
        .into_iter()
        .filter(|link| owned.contains(&link.mac_id))
        .collect())
}

#[tauri::command]
pub fn save_google_link(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    input: GoogleLinkInput,
) -> CmdResult<GoogleLink> {
    let conn = db.conn.lock().map_err(err)?;
    crate::services::access::guard_sheet(&conn, &google, input.sheet_id)?;
    save(&conn, &input)
}

#[tauri::command]
pub fn google_link_synced(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    sheet_id: i64,
    row_count: i64,
    header_map: Map<String, Value>,
) -> CmdResult<GoogleLink> {
    let conn = db.conn.lock().map_err(err)?;
    crate::services::access::guard_sheet(&conn, &google, sheet_id)?;
    synced(&conn, sheet_id, row_count, &header_map)
}

#[tauri::command]
pub fn delete_google_link(
    db: State<'_, Db>,
    google: State<'_, crate::services::google::GoogleState>,
    sheet_id: i64,
) -> CmdResult<()> {
    let conn = db.conn.lock().map_err(err)?;
    crate::services::access::guard_sheet(&conn, &google, sheet_id)?;
    remove(&conn, sheet_id)
}
