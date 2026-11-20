//! Rows: add, edit, reorder and delete them, and undo an import.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use serde_json::{Map, Value};
use tauri::State;

use crate::db::Db;
use crate::db::rows::{insert_rows, load_rows_by_id, set_row_order};
use crate::error::{CmdResult, err};
use crate::models::{CellChange, ImportInfo, ImportRecord, Row};
use crate::services::access;
use crate::services::google::GoogleState;

/// Adds rows (`after_row_id`: right after that row, else last). From an
/// Excel import (`import`), the rows are remembered as that import's, to
/// take out again in one go; `replace` takes the table's rows out first.
#[tauri::command]
pub fn add_rows(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    sheet_id: i64,
    rows: Vec<Map<String, Value>>,
    after_row_id: Option<i64>,
    import: Option<ImportInfo>,
) -> CmdResult<Vec<Row>> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let tx = conn.transaction().map_err(err)?;
    let import_id = match &import {
        Some(info) => {
            if info.mode == "replace" {
                tx.execute("DELETE FROM sheet_rows WHERE sheet_id = ?1", [sheet_id])
                    .map_err(err)?;
                // The rows put back are numbered from 1 again (db/ids.rs), not after the ones just taken out.
                crate::db::ids::restart(&tx, sheet_id).map_err(err)?;
            }
            tx.execute(
                "INSERT INTO imports (sheet_id, file_name, mode, row_count) VALUES (?1, ?2, ?3, ?4)",
                params![sheet_id, info.file_name, info.mode, rows.len() as i64],
            )
            .map_err(err)?;
            Some(tx.last_insert_rowid())
        }
        None => None,
    };
    let ids = insert_rows(&tx, sheet_id, rows, after_row_id, import_id)?;
    tx.execute(
        "UPDATE sheets SET updated_at = datetime('now') WHERE sheet_id = ?1",
        [sheet_id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    load_rows_by_id(&conn, &ids)
}

#[tauri::command]
pub fn update_cells(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    sheet_id: i64,
    mut changes: Vec<CellChange>,
) -> CmdResult<Vec<Row>> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    // An ID is the app's to give: an edit to it is dropped.
    if let Some(key) = crate::db::ids::auto_key(&conn, sheet_id).map_err(err)? {
        changes.retain(|change| change.key != key);
    }
    let tx = conn.transaction().map_err(err)?;
    let mut by_row: HashMap<i64, Vec<CellChange>> = HashMap::new();
    for change in changes {
        by_row.entry(change.row_id).or_default().push(change);
    }
    let ids: Vec<i64> = by_row.keys().copied().collect();
    for (row_id, changes) in by_row {
        let data: Option<String> = tx
            .query_row(
                "SELECT data FROM sheet_rows WHERE row_id = ?1 AND sheet_id = ?2",
                params![row_id, sheet_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(data) = data else { continue };
        let mut cells: Map<String, Value> = serde_json::from_str(&data).unwrap_or_default();
        for change in changes {
            match change.value.map(|value| value.trim().to_string()) {
                Some(value) if !value.is_empty() => {
                    cells.insert(change.key, Value::String(value));
                }
                _ => {
                    cells.remove(&change.key);
                }
            }
        }
        tx.execute(
            "UPDATE sheet_rows SET data = ?2, updated_at = datetime('now') WHERE row_id = ?1",
            params![row_id, serde_json::to_string(&cells).map_err(err)?],
        )
        .map_err(err)?;
    }
    tx.execute(
        "UPDATE sheets SET updated_at = datetime('now') WHERE sheet_id = ?1",
        [sheet_id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    load_rows_by_id(&conn, &ids)
}

#[tauri::command]
pub fn reorder_rows(db: State<'_, Db>, google: State<'_, GoogleState>, sheet_id: i64, row_ids: Vec<i64>) -> CmdResult<()> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let tx = conn.transaction().map_err(err)?;
    set_row_order(&tx, sheet_id, &row_ids)?;
    tx.execute(
        "UPDATE sheets SET updated_at = datetime('now') WHERE sheet_id = ?1",
        [sheet_id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_rows(db: State<'_, Db>, google: State<'_, GoogleState>, sheet_id: i64, row_ids: Vec<i64>) -> CmdResult<()> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let tx = conn.transaction().map_err(err)?;
    for row_id in row_ids {
        tx.execute(
            "DELETE FROM sheet_rows WHERE row_id = ?1 AND sheet_id = ?2",
            params![row_id, sheet_id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn list_imports(db: State<'_, Db>, google: State<'_, GoogleState>, sheet_id: i64) -> CmdResult<Vec<ImportRecord>> {
    let conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let mut statement = conn
        .prepare(
            "SELECT i.import_id, i.sheet_id, i.file_name, i.mode, i.row_count,
                (SELECT COUNT(*) FROM sheet_rows r WHERE r.import_id = i.import_id),
                i.imported_at
             FROM imports i WHERE i.sheet_id = ?1 ORDER BY i.import_id DESC",
        )
        .map_err(err)?;
    let imports = statement
        .query_map([sheet_id], |row| {
            Ok(ImportRecord {
                import_id: row.get(0)?,
                sheet_id: row.get(1)?,
                file_name: row.get(2)?,
                mode: row.get(3)?,
                row_count: row.get(4)?,
                rows_left: row.get(5)?,
                imported_at: row.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    imports
}

/// Takes out the rows an import brought (those still there).
#[tauri::command]
pub fn undo_import(db: State<'_, Db>, google: State<'_, GoogleState>, import_id: i64) -> CmdResult<i64> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_import(&conn, &google, import_id)?;
    let tx = conn.transaction().map_err(err)?;
    let removed = tx
        .execute("DELETE FROM sheet_rows WHERE import_id = ?1", [import_id])
        .map_err(err)?;
    tx.execute("DELETE FROM imports WHERE import_id = ?1", [import_id])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(removed as i64)
}
