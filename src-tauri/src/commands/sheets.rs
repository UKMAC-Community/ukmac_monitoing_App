//! Tables: create, rename, re-column, reorder and delete them, and keep their dashboards.

use std::collections::HashSet;

use rusqlite::params;
use serde_json::{Map, Value};
use tauri::State;

use crate::db::Db;
use crate::db::macs::clean;
use crate::db::rows::{insert_rows, load_rows};
use crate::db::sheets::{
    assign_keys, check_title, insert_sheet, load_sheet, load_sheets, replace_ref, rewrite_columns,
    store_columns, table_refs,
};
use crate::error::{CmdResult, err};
use crate::models::{Column, Sheet, SheetWithRows};
use crate::services::{access, template};
use crate::services::google::GoogleState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_sheet(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    mac_id: i64,
    title: String,
    heading: Option<String>,
    about: Option<String>,
    icon: Option<String>,
    columns: Option<Vec<Column>>,
    rows: Option<Vec<Map<String, Value>>>,
) -> CmdResult<SheetWithRows> {
    let title = check_title(&title)?;
    let heading = clean(heading).unwrap_or_else(|| "My tables".into());
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_mac(&conn, &google, mac_id)?;
    let order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(display_order), -1) + 1 FROM sheets WHERE mac_id = ?1",
            [mac_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let mut columns =
        columns.unwrap_or_else(|| vec![Column::new("Date", "date"), Column::new("Note", "text")]);
    // Every table has an ID column, the first, numbered by the app.
    if !columns.iter().any(|column| column.auto) {
        columns.insert(0, template::id_column());
    }
    let sheet_id = insert_sheet(
        &tx,
        mac_id,
        &title,
        &heading,
        icon.as_deref(),
        about.as_deref().unwrap_or("").trim(),
        None,
        columns,
        order,
    )?;
    if let Some(rows) = rows {
        insert_rows(&tx, sheet_id, rows, None, None)?;
    }
    tx.commit().map_err(err)?;
    let sheet = load_sheet(&conn, sheet_id)?;
    let rows = load_rows(&conn, sheet_id)?;
    Ok(SheetWithRows { sheet, rows })
}

#[tauri::command]
pub fn update_sheet(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    sheet_id: i64,
    title: String,
    heading: Option<String>,
    about: Option<String>,
    icon: Option<String>,
) -> CmdResult<Sheet> {
    let title = check_title(&title)?;
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let before = load_sheet(&conn, sheet_id)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "UPDATE sheets SET title = ?2, heading = COALESCE(?3, heading), about = COALESCE(?4, about),
            icon = COALESCE(?5, icon), updated_at = datetime('now')
         WHERE sheet_id = ?1",
        params![
            sheet_id,
            title,
            clean(heading),
            about.map(|text| text.trim().to_string()),
            clean(icon)
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            format!("This MAC already has a table called {title}")
        }
        other => other.to_string(),
    })?;
    // Renamed: the formulas and links naming it follow.
    if before.title != title {
        let old_refs = table_refs(&before.title);
        let new_ref = format!("'{}'[", title.replace('\'', "''"));
        for mut other in load_sheets(&tx, before.mac_id)? {
            let changed = rewrite_columns(&mut other.columns, &|text: &str| {
                old_refs.iter().fold(text.to_string(), |acc, old| {
                    replace_ref(&acc, old, &new_ref)
                })
            });
            if changed {
                store_columns(&tx, other.sheet_id, &other.columns)?;
            }
        }
    }
    tx.commit().map_err(err)?;
    load_sheet(&conn, sheet_id)
}

/// What the chili template gives a table (by the `template_key` it was made with): its columns now, and the ones it
/// used to give that are gone. A table made before can be brought up to date with them.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateColumns {
    pub columns: Vec<Column>,
    pub retired: Vec<template::Retired>,
}

#[tauri::command]
pub fn template_columns(template_key: String) -> TemplateColumns {
    let (columns, retired) = template::columns_and_retired(&template_key);
    TemplateColumns { columns, retired }
}

/// Saves a table's columns as the editor has them: new ones get keys, a
/// column left out is deleted with its cells, a renamed one's formulas and
/// links follow it.
#[tauri::command]
pub fn save_columns(db: State<'_, Db>, google: State<'_, GoogleState>, sheet_id: i64, columns: Vec<Column>) -> CmdResult<Sheet> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let before = load_sheet(&conn, sheet_id)?;
    let next_key: i64 = conn
        .query_row(
            "SELECT next_key FROM sheets WHERE sheet_id = ?1",
            [sheet_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    let known: HashSet<String> = before.columns.iter().map(|c| c.key.clone()).collect();
    let mut columns: Vec<Column> = columns
        .into_iter()
        .map(|mut column| {
            // A key the table never gave is a new column's.
            if !known.contains(&column.key) {
                column.key.clear();
            }
            column
        })
        .collect();
    let next_key = assign_keys(&mut columns, next_key)?;

    // Renamed columns: name → new name, for this table's formulas and the
    // other tables' links to it.
    let renamed: Vec<(String, String)> = before
        .columns
        .iter()
        .filter_map(|old| {
            columns
                .iter()
                .find(|new| new.key == old.key && new.name != old.name)
                .map(|new| (old.name.clone(), new.name.clone()))
        })
        .filter(|(old, _)| !columns.iter().any(|column| &column.name == old))
        .collect();

    let tx = conn.transaction().map_err(err)?;
    if !renamed.is_empty() {
        rewrite_columns(&mut columns, &|text: &str| {
            renamed.iter().fold(text.to_string(), |acc, (old, new)| {
                acc.replace(&format!("[{old}]"), &format!("[{new}]"))
                    .replace(&format!("› {old}]"), &format!("› {new}]"))
            })
        });
        let refs = table_refs(&before.title);
        for mut other in load_sheets(&tx, before.mac_id)? {
            if other.sheet_id == sheet_id {
                continue;
            }
            let changed = rewrite_columns(&mut other.columns, &|text: &str| {
                renamed.iter().fold(text.to_string(), |acc, (old, new)| {
                    refs.iter().fold(acc, |acc, table| {
                        acc.replace(&format!("{table}{old}]"), &format!("{table}{new}]"))
                    })
                })
            });
            if changed {
                store_columns(&tx, other.sheet_id, &other.columns)?;
            }
        }
    }

    tx.execute(
        "UPDATE sheets SET columns = ?2, next_key = ?3, updated_at = datetime('now')
         WHERE sheet_id = ?1",
        params![
            sheet_id,
            serde_json::to_string(&columns).map_err(err)?,
            next_key
        ],
    )
    .map_err(err)?;

    // Deleted columns' cells go with them (and a formula's never stay).
    let keep: HashSet<&str> = columns
        .iter()
        .filter(|column| column.col_type != "formula")
        .map(|column| column.key.as_str())
        .collect();
    let removed: Vec<&str> = before
        .columns
        .iter()
        .map(|column| column.key.as_str())
        .filter(|key| !keep.contains(key))
        .collect();
    if !removed.is_empty() {
        let mut path_args = String::new();
        for key in &removed {
            path_args.push_str(&format!(", '$.{key}'"));
        }
        tx.execute(
            &format!(
                "UPDATE sheet_rows SET data = json_remove(data{path_args}) WHERE sheet_id = ?1"
            ),
            [sheet_id],
        )
        .map_err(err)?;
    }
    // A table that has just gained an ID column has its rows numbered now.
    crate::db::ids::fill_missing(&tx, sheet_id).map_err(err)?;
    tx.commit().map_err(err)?;
    load_sheet(&conn, sheet_id)
}

/// Saves a table's dashboard (null: back to the suggested one).
#[tauri::command]
pub fn save_dashboard(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    sheet_id: i64,
    dashboard: Option<Value>,
) -> CmdResult<Sheet> {
    let conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    let text = match &dashboard {
        Some(value) => Some(serde_json::to_string(value).map_err(err)?),
        None => None,
    };
    conn.execute(
        "UPDATE sheets SET dashboard = ?2, updated_at = datetime('now') WHERE sheet_id = ?1",
        params![sheet_id, text],
    )
    .map_err(err)?;
    load_sheet(&conn, sheet_id)
}

#[tauri::command]
pub fn delete_sheet(db: State<'_, Db>, google: State<'_, GoogleState>, sheet_id: i64) -> CmdResult<()> {
    let conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
    conn.execute("DELETE FROM sheets WHERE sheet_id = ?1", [sheet_id])
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn reorder_sheets(db: State<'_, Db>, google: State<'_, GoogleState>, mac_id: i64, sheet_ids: Vec<i64>) -> CmdResult<()> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_mac(&conn, &google, mac_id)?;
    let tx = conn.transaction().map_err(err)?;
    for (order, sheet_id) in sheet_ids.iter().enumerate() {
        tx.execute(
            "UPDATE sheets SET display_order = ?3 WHERE sheet_id = ?1 AND mac_id = ?2",
            params![sheet_id, mac_id, order as i64],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_gives_a_tables_columns_by_its_key() {
        let qc = template_columns("qa-qc-management".into());
        assert_eq!(qc.columns.len(), 288);
        assert_eq!(qc.columns[0].name, "ID");
        assert_eq!(qc.columns[1].name, "Date");
        // Keys are the table's to give: none here.
        assert!(qc.columns.iter().all(|column| column.key.is_empty()));
        // What the table had and no longer has: its planned dates, days, plant averages and pest totals, the dashboards' sums and the checks.
        assert_eq!(qc.retired.len(), 34 + 5 + 7);
        assert!(
            qc.retired
                .iter()
                .any(|old| old.name == "Days after transplant")
        );
        assert!(
            qc.retired
                .iter()
                .any(|old| old.group.as_deref() == Some("Plant average"))
        );
        let none = template_columns("not-a-template".into());
        assert!(none.columns.is_empty() && none.retired.is_empty());
        let other = template_columns("nursery-batches".into());
        assert!(!other.columns.is_empty() && other.retired.is_empty());
        assert!(template_columns(String::new()).columns.is_empty());
    }
}
