//! Claiming the MACs made before Google accounts existed.

use rusqlite::params;

use crate::error::{CmdResult, err};
use crate::services::access::{require, Unowned, unowned};
use crate::services::google::GoogleState;

#[tauri::command]
pub fn unowned_macs(
    db: tauri::State<'_, crate::db::Db>,
    google: tauri::State<'_, GoogleState>,
) -> CmdResult<Vec<Unowned>> {
    require(&google)?;
    let conn = db.conn.lock().map_err(err)?;
    unowned(&conn)
}

/// The signed-in account takes these MACs, if nobody has them yet (the page checked the Google
/// Sheets of each that has links: the account can open them).
#[tauri::command]
pub fn claim_macs(
    db: tauri::State<'_, crate::db::Db>,
    google: tauri::State<'_, GoogleState>,
    mac_ids: Vec<i64>,
) -> CmdResult<usize> {
    let email = require(&google)?;
    let conn = db.conn.lock().map_err(err)?;
    let mut taken = 0;
    for mac_id in mac_ids {
        taken += conn
            .execute(
                "INSERT INTO mac_access (mac_id, email)
                 SELECT mac_id, ?2 FROM macs WHERE mac_id = ?1
                   AND mac_id NOT IN (SELECT mac_id FROM mac_access)",
                params![mac_id, email],
            )
            .map_err(err)?;
    }
    Ok(taken)
}
