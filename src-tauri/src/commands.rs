//! The app's local backend: what the Angular side calls (`invoke`).
//! Everything is read from and written to the SQLite file on this computer.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::State;

use crate::model::{
    CellChange, Column, ImportInfo, ImportRecord, Mac, MacInput, Row, Sheet, SheetWithRows,
    Workbook,
};
use crate::access;
use crate::google::GoogleState;
use crate::template;

pub struct Db {
    pub conn: Mutex<Connection>,
    pub path: std::path::PathBuf,
}

pub type CmdResult<T> = Result<T, String>;

pub(crate) fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

const COLUMN_TYPES: &[&str] = &[
    "text",
    "number",
    "percentage",
    "date",
    "choice",
    "yesno",
    "link",
    "formula",
];

// ------------------------------------------------------------------ reads

const MAC_SELECT: &str = "SELECT m.mac_id, m.mac_uuid, m.mac_name, m.mac_code, m.mac_location,
        m.latitude, m.longitude, m.start_date, m.end_date, m.crop, m.note, m.created_at,
        m.updated_at,
        (SELECT COUNT(*) FROM sheets s WHERE s.mac_id = m.mac_id),
        (SELECT COUNT(*) FROM sheet_rows r JOIN sheets s ON s.sheet_id = r.sheet_id
            WHERE s.mac_id = m.mac_id)
    FROM macs m";

fn mac_from_row(row: &rusqlite::Row) -> rusqlite::Result<Mac> {
    Ok(Mac {
        mac_id: row.get(0)?,
        mac_uuid: row.get(1)?,
        mac_name: row.get(2)?,
        mac_code: row.get(3)?,
        mac_location: row.get(4)?,
        latitude: row.get(5)?,
        longitude: row.get(6)?,
        start_date: row.get(7)?,
        end_date: row.get(8)?,
        crop: row.get(9)?,
        note: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        sheet_count: row.get(13)?,
        row_count: row.get(14)?,
    })
}

pub(crate) fn load_mac(conn: &Connection, mac_id: i64) -> CmdResult<Mac> {
    conn.query_row(
        &format!("{MAC_SELECT} WHERE m.mac_id = ?1"),
        [mac_id],
        mac_from_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "That MAC doesn't exist any more".to_string())
}

const SHEET_SELECT: &str = "SELECT s.sheet_id, s.mac_id, s.title, s.heading, s.icon, s.about,
        s.template_key, s.columns, s.display_order, s.created_at, s.updated_at,
        (SELECT COUNT(*) FROM sheet_rows r WHERE r.sheet_id = s.sheet_id), s.dashboard
    FROM sheets s";

fn sheet_from_row(row: &rusqlite::Row) -> rusqlite::Result<Sheet> {
    let columns: String = row.get(7)?;
    Ok(Sheet {
        sheet_id: row.get(0)?,
        mac_id: row.get(1)?,
        title: row.get(2)?,
        heading: row.get(3)?,
        icon: row.get(4)?,
        about: row.get(5)?,
        template_key: row.get(6)?,
        columns: serde_json::from_str(&columns).unwrap_or_default(),
        dashboard: row
            .get::<_, Option<String>>(12)?
            .and_then(|text| serde_json::from_str(&text).ok()),
        display_order: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        row_count: row.get(11)?,
    })
}

fn load_sheet(conn: &Connection, sheet_id: i64) -> CmdResult<Sheet> {
    conn.query_row(
        &format!("{SHEET_SELECT} WHERE s.sheet_id = ?1"),
        [sheet_id],
        sheet_from_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "That table doesn't exist any more".to_string())
}

pub(crate) fn load_sheets(conn: &Connection, mac_id: i64) -> CmdResult<Vec<Sheet>> {
    let mut statement = conn
        .prepare(&format!(
            "{SHEET_SELECT} WHERE s.mac_id = ?1 ORDER BY s.display_order, s.sheet_id"
        ))
        .map_err(err)?;
    let sheets = statement
        .query_map([mac_id], sheet_from_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    sheets
}

const ROW_SELECT: &str =
    "SELECT row_id, sheet_id, position, data, import_id, created_at, updated_at FROM sheet_rows";

fn row_from_row(row: &rusqlite::Row) -> rusqlite::Result<Row> {
    let data: String = row.get(3)?;
    Ok(Row {
        row_id: row.get(0)?,
        sheet_id: row.get(1)?,
        position: row.get(2)?,
        data: serde_json::from_str(&data).unwrap_or_default(),
        import_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub(crate) fn load_rows(conn: &Connection, sheet_id: i64) -> CmdResult<Vec<Row>> {
    let mut statement = conn
        .prepare(&format!(
            "{ROW_SELECT} WHERE sheet_id = ?1 ORDER BY position, row_id"
        ))
        .map_err(err)?;
    let rows = statement
        .query_map([sheet_id], row_from_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err);
    rows
}

fn load_rows_by_id(conn: &Connection, ids: &[i64]) -> CmdResult<Vec<Row>> {
    let mut statement = conn
        .prepare(&format!("{ROW_SELECT} WHERE row_id = ?1"))
        .map_err(err)?;
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(row) = statement
            .query_row([id], row_from_row)
            .optional()
            .map_err(err)?
        {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn workbook(conn: &Connection, mac_id: i64) -> CmdResult<Workbook> {
    let mac = load_mac(conn, mac_id)?;
    let sheets = load_sheets(conn, mac_id)?
        .into_iter()
        .map(|sheet| {
            let rows = load_rows(conn, sheet.sheet_id)?;
            Ok(SheetWithRows { sheet, rows })
        })
        .collect::<CmdResult<Vec<_>>>()?;
    Ok(Workbook { mac, sheets })
}

// ------------------------------------------------------------- MACs

fn clean(text: Option<String>) -> Option<String> {
    text.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn check_mac(input: &MacInput) -> CmdResult<(String, String)> {
    let name = input.mac_name.trim().to_string();
    let code = input.mac_code.trim().to_string();
    if name.is_empty() {
        return Err("Give the MAC a name".into());
    }
    if code.is_empty() {
        return Err("Give the MAC a code".into());
    }
    if let (Some(start), Some(end)) = (
        clean(input.start_date.clone()),
        clean(input.end_date.clone()),
    ) {
        if end < start {
            return Err("The end date is before the start date".into());
        }
    }
    if let Some(latitude) = input.latitude {
        if !(-90.0..=90.0).contains(&latitude) {
            return Err("Latitude goes from -90 to 90".into());
        }
    }
    if let Some(longitude) = input.longitude {
        if !(-180.0..=180.0).contains(&longitude) {
            return Err("Longitude goes from -180 to 180".into());
        }
    }
    Ok((name, code))
}

pub(crate) fn code_taken(conn: &Connection, code: &str, except: Option<i64>) -> CmdResult<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT mac_id FROM macs WHERE mac_code = ?1 COLLATE NOCASE",
            [code],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(matches!(found, Some(id) if Some(id) != except))
}

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

// ------------------------------------------------------------- tables

/// Gives every column without a key the next one (`c<n>`), and checks
/// names and types. Returns the next key number.
fn assign_keys(columns: &mut [Column], mut next_key: i64) -> CmdResult<i64> {
    let mut taken = HashSet::new();
    for column in columns.iter_mut() {
        column.name = column.name.trim().to_string();
        if column.name.is_empty() {
            return Err("Every column needs a name".into());
        }
        if column.name.contains('[') || column.name.contains(']') || column.name.contains('›') {
            return Err(format!(
                "“{}”: a column's name can't have [ ] or › in it",
                column.name
            ));
        }
        if !COLUMN_TYPES.contains(&column.col_type.as_str()) {
            return Err(format!(
                "“{}”: unknown column type {}",
                column.name, column.col_type
            ));
        }
        for text in [
            &mut column.unit,
            &mut column.group,
            &mut column.box_name,
            &mut column.note,
        ] {
            *text = clean(text.take());
        }
        if column
            .box_name
            .as_deref()
            .is_some_and(|name| name.contains('›'))
        {
            return Err(format!(
                "“{}”: a box's name can't have › in it",
                column.name
            ));
        }
        column.aliases = column
            .aliases
            .iter()
            .map(|alias| alias.trim().to_string())
            .filter(|alias| !alias.is_empty())
            .collect();
        column.options = column
            .options
            .iter()
            .map(|option| option.trim().to_string())
            .filter(|option| !option.is_empty())
            .collect();
        if column.key.is_empty() || taken.contains(&column.key) {
            column.key = format!("c{next_key}");
            next_key += 1;
        }
        taken.insert(column.key.clone());
    }
    Ok(next_key)
}

/// The next free column key number after the keys these columns already have (`c7` → 8).
fn next_key_after(columns: &[Column]) -> i64 {
    columns
        .iter()
        .filter_map(|column| column.key.strip_prefix('c')?.parse::<i64>().ok())
        .max()
        .map_or(1, |highest| highest + 1)
}

#[allow(clippy::too_many_arguments)]
fn insert_sheet(
    tx: &Transaction,
    mac_id: i64,
    title: &str,
    heading: &str,
    icon: Option<&str>,
    about: &str,
    template_key: Option<&str>,
    columns: Vec<Column>,
    display_order: i64,
) -> CmdResult<i64> {
    insert_sheet_from(
        tx,
        mac_id,
        title,
        heading,
        icon,
        about,
        template_key,
        columns,
        display_order,
        1,
    )
}

/// Adds a table. Columns that already have keys keep them (a table read back from a file), and
/// the next new key starts after them and after `min_next_key` (keys of deleted columns are never
/// handed out again, or their old cells would show up under the new column).
#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_sheet_from(
    tx: &Transaction,
    mac_id: i64,
    title: &str,
    heading: &str,
    icon: Option<&str>,
    about: &str,
    template_key: Option<&str>,
    mut columns: Vec<Column>,
    display_order: i64,
    min_next_key: i64,
) -> CmdResult<i64> {
    let first_free = min_next_key.max(next_key_after(&columns));
    let next_key = assign_keys(&mut columns, first_free)?;
    tx.execute(
        "INSERT INTO sheets (mac_id, title, heading, icon, about, template_key, columns, next_key,
            display_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            mac_id,
            title,
            heading,
            icon,
            about,
            template_key,
            serde_json::to_string(&columns).map_err(err)?,
            next_key,
            display_order
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
    Ok(tx.last_insert_rowid())
}

pub(crate) fn check_title(title: &str) -> CmdResult<String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Give the table a name".into());
    }
    if title.contains('[') || title.contains(']') {
        return Err("A table's name can't have [ or ] in it".into());
    }
    Ok(title)
}

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
    let columns =
        columns.unwrap_or_else(|| vec![Column::new("Date", "date"), Column::new("Note", "text")]);
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

/// A table's name in a formula or link: `'Name'[`, and `Name[` for a
/// one-word name.
fn table_refs(title: &str) -> Vec<String> {
    let mut refs = vec![format!("'{}'[", title.replace('\'', "''"))];
    if title.chars().all(|c| c.is_alphanumeric() || c == '_') {
        refs.push(format!("{title}["));
    }
    refs
}

fn rewrite_columns(columns: &mut [Column], rewrite: &dyn Fn(&str) -> String) -> bool {
    let mut changed = false;
    for column in columns.iter_mut() {
        for text in [&mut column.formula, &mut column.source] {
            if let Some(value) = text.as_ref() {
                let next = rewrite(value);
                if &next != value {
                    *text = Some(next);
                    changed = true;
                }
            }
        }
    }
    changed
}

fn store_columns(conn: &Connection, sheet_id: i64, columns: &[Column]) -> CmdResult<()> {
    conn.execute(
        "UPDATE sheets SET columns = ?2, updated_at = datetime('now') WHERE sheet_id = ?1",
        params![sheet_id, serde_json::to_string(columns).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
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

/// Replaces `old` with `new` where it isn't the tail of a longer name
/// (`Zones[` in `MyZones[` stays).
fn replace_ref(text: &str, old: &str, new: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(old) {
        let before = &rest[..at];
        let joined = !old.starts_with('\'')
            && before
                .chars()
                .last()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '\'');
        out.push_str(before);
        out.push_str(if joined { old } else { new });
        rest = &rest[at + old.len()..];
    }
    out.push_str(rest);
    out
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

// ------------------------------------------------------------------ rows

/// Only the cells worth keeping: no blanks, text only.
fn clean_cells(data: Map<String, Value>) -> Map<String, Value> {
    data.into_iter()
        .filter_map(|(key, value)| {
            let text = match value {
                Value::Null => return None,
                Value::String(text) => text,
                Value::Bool(flag) => flag.to_string(),
                Value::Number(number) => number.to_string(),
                other => other.to_string(),
            };
            let text = text.trim().to_string();
            (!text.is_empty()).then_some((key, Value::String(text)))
        })
        .collect()
}

pub(crate) fn insert_rows(
    tx: &Transaction,
    sheet_id: i64,
    rows: Vec<Map<String, Value>>,
    after_row_id: Option<i64>,
    import_id: Option<i64>,
) -> CmdResult<Vec<i64>> {
    // Where they go: after a row (between it and the next), at the top
    // (`0`), else last.
    let (start, step) = match after_row_id {
        Some(0) => {
            let first: f64 = tx
                .query_row(
                    "SELECT COALESCE(MIN(position), 1) FROM sheet_rows WHERE sheet_id = ?1",
                    [sheet_id],
                    |row| row.get(0),
                )
                .map_err(err)?;
            (first - rows.len() as f64 - 1.0, 1.0)
        }
        Some(after) => {
            let at: f64 = tx
                .query_row(
                    "SELECT position FROM sheet_rows WHERE row_id = ?1 AND sheet_id = ?2",
                    params![after, sheet_id],
                    |row| row.get(0),
                )
                .map_err(err)?;
            let next: Option<f64> = tx
                .query_row(
                    "SELECT MIN(position) FROM sheet_rows WHERE sheet_id = ?1 AND position > ?2",
                    params![sheet_id, at],
                    |row| row.get(0),
                )
                .map_err(err)?;
            let gap = next.unwrap_or(at + rows.len() as f64 + 1.0) - at;
            (at, gap / (rows.len() as f64 + 1.0))
        }
        None => {
            let last: f64 = tx
                .query_row(
                    "SELECT COALESCE(MAX(position), 0) FROM sheet_rows WHERE sheet_id = ?1",
                    [sheet_id],
                    |row| row.get(0),
                )
                .map_err(err)?;
            (last, 1.0)
        }
    };
    let mut statement = tx
        .prepare(
            "INSERT INTO sheet_rows (sheet_id, position, data, import_id) VALUES (?1, ?2, ?3, ?4)",
        )
        .map_err(err)?;
    let mut ids = Vec::with_capacity(rows.len());
    for (index, data) in rows.into_iter().enumerate() {
        let data = serde_json::to_string(&clean_cells(data)).map_err(err)?;
        statement
            .execute(params![
                sheet_id,
                start + step * (index as f64 + 1.0),
                data,
                import_id
            ])
            .map_err(err)?;
        ids.push(tx.last_insert_rowid());
    }
    Ok(ids)
}

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
    changes: Vec<CellChange>,
) -> CmdResult<Vec<Row>> {
    let mut conn = db.conn.lock().map_err(err)?;
    access::guard_sheet(&conn, &google, sheet_id)?;
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

/// The rows in this order (sorted or moved in the sheet): the ones named
/// first, one after another; any not named keep their order after them.
fn set_row_order(tx: &Transaction, sheet_id: i64, row_ids: &[i64]) -> CmdResult<()> {
    let mut seen = HashSet::new();
    let mut order: Vec<i64> = row_ids
        .iter()
        .copied()
        .filter(|id| seen.insert(*id))
        .collect();
    let mut statement = tx
        .prepare("SELECT row_id FROM sheet_rows WHERE sheet_id = ?1 ORDER BY position, row_id")
        .map_err(err)?;
    let rest = statement
        .query_map([sheet_id], |row| row.get::<_, i64>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let known: HashSet<i64> = rest.iter().copied().collect();
    order.retain(|id| known.contains(id));
    order.extend(rest.into_iter().filter(|id| !seen.contains(id)));
    let mut update = tx
        .prepare("UPDATE sheet_rows SET position = ?1 WHERE row_id = ?2 AND sheet_id = ?3")
        .map_err(err)?;
    for (index, row_id) in order.iter().enumerate() {
        update
            .execute(params![(index + 1) as f64, row_id, sheet_id])
            .map_err(err)?;
    }
    Ok(())
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

// ------------------------------------------------------- files, settings

#[tauri::command]
pub fn read_file(path: String) -> CmdResult<tauri::ipc::Response> {
    let metadata = std::fs::metadata(&path).map_err(err)?;
    if metadata.len() > 30 * 1024 * 1024 {
        return Err("Keep the file under 30 MB".into());
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((high * 16 + low) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Writes the request's bytes to the file its `path` header names
/// (percent-encoded).
#[tauri::command]
pub fn write_file(request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("path")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .ok_or("No file to write to")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing to write".into());
    };
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
    }
    std::fs::write(&path, bytes).map_err(err)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let path = std::env::temp_dir().join(format!("ukmac-test-{}.db", uuid::Uuid::new_v4()));
        crate::db::open(&path).unwrap()
    }

    fn mac(conn: &Connection) -> i64 {
        conn.execute(
            "INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'Farm', 'F-1')",
            [],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn a_chili_mac_gets_its_tables_with_keys() {
        let mut conn = memory();
        let mac_id = mac(&conn);
        let tx = conn.transaction().unwrap();
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
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let sheets = load_sheets(&conn, mac_id).unwrap();
        assert_eq!(sheets.len(), 15);
        let qc = sheets
            .iter()
            .find(|s| s.title == "QA/QC Management")
            .unwrap();
        assert_eq!(qc.columns[0].key, "c1");
        assert_eq!(qc.columns.last().unwrap().key, "c299");
        assert!(qc.dashboard.is_none());
    }

    #[test]
    fn the_template_gives_a_tables_columns_by_its_key() {
        let qc = template_columns("qa-qc-management".into());
        assert_eq!(qc.columns.len(), 299);
        assert_eq!(qc.columns[0].name, "Date");
        // Keys are the table's to give: none here.
        assert!(qc.columns.iter().all(|column| column.key.is_empty()));
        // What the table had and no longer has: its planned dates, days, plant averages and pest totals.
        assert_eq!(qc.retired.len(), 34);
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

    #[test]
    fn rows_go_last_after_a_row_or_at_the_top() {
        let mut conn = memory();
        let mac_id = mac(&conn);
        let tx = conn.transaction().unwrap();
        let sheet = insert_sheet(
            &tx,
            mac_id,
            "T",
            "H",
            None,
            "",
            None,
            vec![Column::new("A", "text")],
            0,
        )
        .unwrap();
        let row = |text: &str| {
            let mut map = Map::new();
            map.insert("c1".into(), Value::String(text.into()));
            map
        };
        let first = insert_rows(&tx, sheet, vec![row("1"), row("3")], None, None).unwrap();
        insert_rows(&tx, sheet, vec![row("2")], Some(first[0]), None).unwrap();
        insert_rows(&tx, sheet, vec![row("0")], Some(0), None).unwrap();
        insert_rows(&tx, sheet, vec![row("4"), row(" ")], None, None).unwrap();
        tx.commit().unwrap();
        let rows = load_rows(&conn, sheet).unwrap();
        let order: Vec<String> = rows
            .iter()
            .map(|r| {
                r.data
                    .get("c1")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        assert_eq!(order, ["0", "1", "2", "3", "4", ""]);
    }

    #[test]
    fn a_sorted_sheet_keeps_its_order() {
        let mut conn = memory();
        let mac_id = mac(&conn);
        let tx = conn.transaction().unwrap();
        let sheet = insert_sheet(
            &tx,
            mac_id,
            "T",
            "H",
            None,
            "",
            None,
            vec![Column::new("A", "text")],
            0,
        )
        .unwrap();
        let other = insert_sheet(
            &tx,
            mac_id,
            "U",
            "H",
            None,
            "",
            None,
            vec![Column::new("A", "text")],
            1,
        )
        .unwrap();
        let row = |text: &str| {
            let mut map = Map::new();
            map.insert("c1".into(), Value::String(text.into()));
            map
        };
        let ids = insert_rows(
            &tx,
            sheet,
            vec![row("a"), row("b"), row("c"), row("d")],
            None,
            None,
        )
        .unwrap();
        let theirs = insert_rows(&tx, other, vec![row("x")], None, None).unwrap();
        // c, a first (named twice, and another table's row, by mistake); b and d after, as they were.
        set_row_order(&tx, sheet, &[ids[2], ids[0], ids[2], theirs[0]]).unwrap();
        tx.commit().unwrap();
        let order: Vec<String> = load_rows(&conn, sheet)
            .unwrap()
            .iter()
            .map(|r| {
                r.data
                    .get("c1")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        assert_eq!(order, ["c", "a", "b", "d"]);
        assert_eq!(load_rows(&conn, other).unwrap().len(), 1);
    }

    #[test]
    fn keys_are_never_given_twice() {
        let mut columns = vec![Column::new("A", "text"), Column::new("B", "number")];
        columns[0].key = "c1".into();
        let next = assign_keys(&mut columns, 5).unwrap();
        assert_eq!(columns[0].key, "c1");
        assert_eq!(columns[1].key, "c5");
        assert_eq!(next, 6);
        let mut bad = vec![Column::new("A [x]", "text")];
        assert!(assign_keys(&mut bad, 1).is_err());
    }

    #[test]
    fn a_renamed_table_keeps_its_links() {
        assert_eq!(
            replace_ref("='Zones'[Plot]", "'Zones'[", "'Plots'["),
            "='Plots'[Plot]"
        );
        assert_eq!(
            replace_ref("=Zones[Plot]+MyZones[Plot]", "Zones[", "'Plots'["),
            "='Plots'[Plot]+MyZones[Plot]"
        );
    }

    #[test]
    fn paths_come_through_the_header() {
        assert_eq!(
            percent_decode("%2FUsers%2Fy%2FUKMAC%20%E1%9E%80.xlsx"),
            "/Users/y/UKMAC \u{1780}.xlsx"
        );
    }
}
