//! MACs (farms): list, create, edit and delete them, and read a MAC's whole workbook.

use rusqlite::params;
use tauri::State;

use crate::db::Db;
use crate::db::macs::{check_mac, clean, code_taken, load_mac, mac_from_row, MAC_SELECT, workbook};
use crate::db::sheets::insert_sheet;
use crate::error::{CmdResult, err};
use crate::models::{Mac, MacInput, Workbook};
use crate::services::{access, template};
use crate::services::google::GoogleState;

#[tauri::command]
pub fn list_macs(db: State<'_, Db>, google: State<'_, GoogleState>) -> CmdResult<Vec<Mac>> {
    // Nobody signed in, nothing shown; a signed-in account sees only its own MACs.
    let Some(email) = google.account() else {
        return Ok(Vec::new());
    };
    let conn = db.conn.lock().map_err(err)?;
    let mut statement = conn
        .prepare(&format!(
            "{MAC_SELECT} WHERE m.mac_id IN (SELECT mac_id FROM mac_access WHERE email = ?1)
             ORDER BY m.mac_name COLLATE NOCASE"
        ))
        .map_err(err)?;
    let macs = statement
        .query_map([email], mac_from_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    macs
}

#[tauri::command]
pub fn create_mac(db: State<'_, Db>, google: State<'_, GoogleState>, input: MacInput) -> CmdResult<Mac> {
    let email = access::require(&google)?;
    let (name, code) = check_mac(&input)?;
    let mut conn = db.conn.lock().map_err(err)?;
    if code_taken(&conn, &code, None)? {
        return Err(format!("Another MAC already has the code {code}"));
    }
    let crop = clean(input.crop.clone()).unwrap_or_else(|| "chili".into());
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO macs (mac_uuid, mac_name, mac_code, mac_location, latitude, longitude,
            start_date, end_date, crop, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            name,
            code,
            clean(input.mac_location.clone()),
            input.latitude,
            input.longitude,
            clean(input.start_date.clone()),
            clean(input.end_date.clone()),
            crop,
            clean(input.note.clone()),
        ],
    )
    .map_err(err)?;
    let mac_id = tx.last_insert_rowid();
    access::grant(&tx, mac_id, &email)?;
    if input.use_template.unwrap_or(true) && crop == "chili" {
        for (order, sheet) in template::chili_template().into_iter().enumerate() {
            insert_sheet(
                &tx,
                mac_id,
                sheet.title,
                sheet.heading,
                Some(sheet.icon),
                sheet.about,
                Some(sheet.key),
                sheet.columns,
                order as i64,
            )?;
        }
    }
    tx.commit().map_err(err)?;
    load_mac(&conn, mac_id)
}

#[tauri::command]
pub fn update_mac(db: State<'_, Db>, google: State<'_, GoogleState>, mac_id: i64, input: MacInput) -> CmdResult<Mac> {
    let (name, code) = check_mac(&input)?;
    let conn = db.conn.lock().map_err(err)?;
    access::guard_mac(&conn, &google, mac_id)?;
    if code_taken(&conn, &code, Some(mac_id))? {
        return Err(format!("Another MAC already has the code {code}"));
    }
    conn.execute(
        "UPDATE macs SET mac_name = ?2, mac_code = ?3, mac_location = ?4, latitude = ?5,
            longitude = ?6, start_date = ?7, end_date = ?8, crop = COALESCE(?9, crop),
            note = ?10, updated_at = datetime('now')
         WHERE mac_id = ?1",
        params![
            mac_id,
            name,
            code,
            clean(input.mac_location.clone()),
            input.latitude,
            input.longitude,
            clean(input.start_date.clone()),
            clean(input.end_date.clone()),
            clean(input.crop.clone()),
            clean(input.note.clone()),
        ],
    )
    .map_err(err)?;
    load_mac(&conn, mac_id)
}

#[tauri::command]
pub fn delete_mac(db: State<'_, Db>, google: State<'_, GoogleState>, mac_id: i64) -> CmdResult<()> {
    let conn = db.conn.lock().map_err(err)?;
    access::guard_mac(&conn, &google, mac_id)?;
    conn.execute("DELETE FROM macs WHERE mac_id = ?1", [mac_id])
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn get_workbook(db: State<'_, Db>, google: State<'_, GoogleState>, mac_id: i64) -> CmdResult<Workbook> {
    let conn = db.conn.lock().map_err(err)?;
    access::guard_mac(&conn, &google, mac_id)?;
    workbook(&conn, mac_id)
}

/// Every MAC's tables and rows (the Power BI export of all farms).
#[tauri::command]
pub fn get_all_workbooks(db: State<'_, Db>, google: State<'_, GoogleState>) -> CmdResult<Vec<Workbook>> {
    let Some(email) = google.account() else {
        return Ok(Vec::new());
    };
    let conn = db.conn.lock().map_err(err)?;
    let ids = {
        let mut statement = conn
            .prepare("SELECT mac_id FROM macs WHERE mac_id IN (SELECT mac_id FROM mac_access WHERE email = ?1)
                 ORDER BY mac_name COLLATE NOCASE")
            .map_err(err)?;
        statement
            .query_map([email], |row| row.get::<_, i64>(0))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?
    };
    ids.into_iter().map(|id| workbook(&conn, id)).collect()
}
