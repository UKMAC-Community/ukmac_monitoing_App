//! A MAC saved to one file, and read back on this or another computer (`.ukmac`).
//!
//! The file is JSON: the MAC, and each of its tables (columns with their keys, the dashboard, the
//! view settings kept for it here, the Google Sheet it is linked to). **It carries no rows**
//! (version 2, `links_only`): a file that gets copied or sent must not be a copy of the farm's
//! data. The data stays in Google, which decides who may read it: opening the file on another
//! computer links each table to its sheet and reads it from there. Tables that are not linked to
//! a Google Sheet have no data to travel and arrive empty. The one exception is the map: the
//! Zones table, when it is not linked to Google, goes in the file with its rows (the plots and
//! their outlines), so the Zone Map is there when the file is opened. The MAC's own location and
//! coordinates are left out.
//!
//! Version 1 files (saved with every row) still open, as copies of what they hold.
//!
//! What is left out on purpose: rows, the farm's location, Google sign-in (tokens and the client
//! secret live outside the database, so they never travel; the other computer signs in itself),
//! global settings such as the Power BI path, and the Excel import history.

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use crate::commands::{
    CmdResult, Db, check_mac, check_title, code_taken, err, insert_rows, insert_sheet_from,
    load_mac, load_rows, load_sheets,
};
use crate::links;
use crate::model::{Column, Mac, MacInput};

pub const FORMAT: &str = "ukmac-mac";
/// What this app writes. It still reads version 1 (a copy with every row).
pub const VERSION: u32 = 2;
/// The settings kept per table (`sheet.<id>.<name>`) that travel with it.
const SHEET_SETTINGS: &[&str] = &["frozenColumns", "conditionalFormats"];
const MAX_FILE: u64 = 300 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacFile {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub app: String,
    /// The file has no rows: the data is read from the linked Google Sheets (version 2).
    #[serde(default)]
    pub links_only: bool,
    pub mac: FileMac,
    #[serde(default)]
    pub sheets: Vec<FileSheet>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMac {
    #[serde(default)]
    pub uuid: String,
    pub name: String,
    pub code: String,
    pub location: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default = "chili")]
    pub crop: String,
    pub note: Option<String>,
}

fn chili() -> String {
    "chili".into()
}

fn one() -> i64 {
    1
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSheet {
    pub title: String,
    #[serde(default)]
    pub heading: String,
    pub icon: Option<String>,
    #[serde(default)]
    pub about: String,
    pub template_key: Option<String>,
    #[serde(default)]
    pub columns: Vec<Column>,
    /// The number the next new column's key starts at (`c<n>`).
    #[serde(default = "one")]
    pub next_key: i64,
    #[serde(default)]
    pub display_order: i64,
    pub dashboard: Option<Value>,
    #[serde(default)]
    pub rows: Vec<FileRow>,
    pub google_link: Option<FileLink>,
    /// View settings kept for the table here: `frozenColumns`, `conditionalFormats`.
    #[serde(default)]
    pub settings: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub data: Map<String, Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLink {
    pub spreadsheet_id: String,
    #[serde(default)]
    pub spreadsheet_title: String,
    #[serde(default)]
    pub tab_title: String,
    #[serde(default)]
    pub header_map: Map<String, Value>,
    pub last_synced_at: Option<String>,
    #[serde(default)]
    pub last_row_count: i64,
    /// Where the tab's names and data are, when the person said (a file from before this has none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<links::FileLayout>,
}

// ------------------------------------------------------------------ save

/// A MAC as a file's content, as it is saved: no rows, no location, each table's Google link kept.
pub fn build(conn: &Connection, mac_id: i64) -> CmdResult<MacFile> {
    assemble(conn, mac_id, true)
}

/// A MAC with every row, the way version 1 files were saved (kept to prove those still open).
#[cfg(test)]
pub fn build_full(conn: &Connection, mac_id: i64) -> CmdResult<MacFile> {
    assemble(conn, mac_id, false)
}

fn assemble(conn: &Connection, mac_id: i64, links_only: bool) -> CmdResult<MacFile> {
    let mac = load_mac(conn, mac_id)?;
    let links = links::list(conn, Some(mac_id))?;
    let exported_at: String = conn
        .query_row("SELECT datetime('now')", [], |row| row.get(0))
        .map_err(err)?;
    let mut sheets = Vec::new();
    for sheet in load_sheets(conn, mac_id)? {
        let next_key: i64 = conn
            .query_row(
                "SELECT next_key FROM sheets WHERE sheet_id = ?1",
                [sheet.sheet_id],
                |row| row.get(0),
            )
            .map_err(err)?;
        // The map travels in the file (the Zones table, when no Google Sheet holds it); no other rows do.
        let carries_map = sheet.template_key.as_deref() == Some("zones")
            && !links.iter().any(|link| link.sheet_id == sheet.sheet_id);
        let rows = if links_only && !carries_map {
            Vec::new()
        } else {
            load_rows(conn, sheet.sheet_id)?
                .into_iter()
                .map(|row| FileRow {
                    position: row.position,
                    data: row.data,
                })
                .collect()
        };
        let mut settings = BTreeMap::new();
        for name in SHEET_SETTINGS {
            let value: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    [format!("sheet.{}.{name}", sheet.sheet_id)],
                    |row| row.get(0),
                )
                .optional()
                .map_err(err)?;
            if let Some(value) = value {
                settings.insert((*name).to_string(), value);
            }
        }
        let google_link = links
            .iter()
            .find(|link| link.sheet_id == sheet.sheet_id)
            .map(|link| FileLink {
                spreadsheet_id: link.spreadsheet_id.clone(),
                spreadsheet_title: link.spreadsheet_title.clone(),
                tab_title: link.tab_title.clone(),
                header_map: link.header_map.clone(),
                // Nothing has been read on the other computer yet.
                last_synced_at: (!links_only).then(|| link.last_synced_at.clone()).flatten(),
                last_row_count: if links_only { 0 } else { link.last_row_count },
                layout: link.layout.clone(),
            });
        sheets.push(FileSheet {
            title: sheet.title,
            heading: sheet.heading,
            icon: sheet.icon,
            about: sheet.about,
            template_key: sheet.template_key,
            columns: sheet.columns,
            next_key,
            display_order: sheet.display_order,
            dashboard: sheet.dashboard,
            rows,
            google_link,
            settings,
        });
    }
    Ok(MacFile {
        format: FORMAT.into(),
        version: if links_only { VERSION } else { 1 },
        exported_at,
        app: format!("UKMAC Monitoring {}", env!("CARGO_PKG_VERSION")),
        links_only,
        mac: FileMac {
            uuid: mac.mac_uuid,
            name: mac.mac_name,
            code: mac.mac_code,
            // Where the farm is does not travel in a file that anyone can open.
            location: if links_only { None } else { mac.mac_location },
            latitude: if links_only { None } else { mac.latitude },
            longitude: if links_only { None } else { mac.longitude },
            start_date: mac.start_date,
            end_date: mac.end_date,
            crop: mac.crop,
            note: mac.note,
        },
        sheets,
    })
}

// ------------------------------------------------------------------ open

fn check_header(file: &MacFile) -> CmdResult<()> {
    if file.format != FORMAT {
        return Err("This isn't a MAC file saved by UKMAC Monitoring.".into());
    }
    if file.version > VERSION {
        return Err("This MAC file was saved by a newer UKMAC Monitoring. Update the app on this computer, then open it again.".into());
    }
    Ok(())
}

fn read(path: &str) -> CmdResult<MacFile> {
    let size = std::fs::metadata(path).map_err(err)?.len();
    if size > MAX_FILE {
        return Err("This file is too big to be a MAC file.".into());
    }
    let bytes = std::fs::read(path).map_err(err)?;
    let file: MacFile = serde_json::from_slice(&bytes).map_err(|error| {
        format!("This isn't a MAC file saved by UKMAC Monitoring, or it is damaged ({error}).")
    })?;
    check_header(&file)?;
    Ok(file)
}

fn mac_input(file: &FileMac) -> MacInput {
    MacInput {
        mac_name: file.name.clone(),
        mac_code: file.code.clone(),
        mac_location: file.location.clone(),
        latitude: file.latitude,
        longitude: file.longitude,
        start_date: file.start_date.clone(),
        end_date: file.end_date.clone(),
        crop: Some(file.crop.clone()),
        note: file.note.clone(),
        use_template: Some(false),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Existing {
    pub mac_id: i64,
    pub mac_name: String,
    pub mac_code: String,
    pub sheet_count: i64,
    pub row_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PeekSheet {
    pub id: String,
    pub title: String,
}

/// What a file holds, and whether this computer already has that MAC.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peek {
    pub mac_name: String,
    pub mac_code: String,
    pub mac_location: Option<String>,
    pub exported_at: String,
    pub sheets: usize,
    pub rows: usize,
    /// The file has no rows: its tables are read from Google after it is opened.
    pub links_only: bool,
    /// How many of its tables are linked to a Google Sheet.
    pub linked_tables: usize,
    /// The Google Sheets it points at, each once.
    pub spreadsheets: Vec<PeekSheet>,
    /// The MAC here that this file is a copy of (the same MAC saved before).
    pub same_mac: Option<Existing>,
    /// Another MAC here already has this file's code (so a copy gets a new one).
    pub code_taken: bool,
}

/// The MAC here that has this id inside the file: when `account` is given, only one that account has (another
/// account's copy is not this person's to see, replace or learn about).
fn existing_with_uuid(
    conn: &Connection,
    uuid: &str,
    account: Option<&str>,
) -> CmdResult<Option<i64>> {
    if uuid.is_empty() {
        return Ok(None);
    }
    match account {
        Some(email) => conn.query_row(
            "SELECT m.mac_id FROM macs m JOIN mac_access a ON a.mac_id = m.mac_id
             WHERE m.mac_uuid = ?1 AND a.email = ?2",
            params![uuid, crate::access::normalize(email)],
            |row| row.get(0),
        ),
        None => conn.query_row(
            "SELECT mac_id FROM macs WHERE mac_uuid = ?1",
            [uuid],
            |row| row.get(0),
        ),
    }
    .optional()
    .map_err(err)
}

/// Any MAC here, of any account, has this id.
fn uuid_in_use(conn: &Connection, uuid: &str) -> CmdResult<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM macs WHERE mac_uuid = ?1)",
        [uuid],
        |row| row.get(0),
    )
    .map_err(err)
}

pub fn peek(conn: &Connection, file: &MacFile, account: Option<&str>) -> CmdResult<Peek> {
    let (_, code) = check_mac(&mac_input(&file.mac))?;
    let same_mac = match existing_with_uuid(conn, &file.mac.uuid, account)? {
        Some(mac_id) => {
            let mac = load_mac(conn, mac_id)?;
            Some(Existing {
                mac_id,
                mac_name: mac.mac_name,
                mac_code: mac.mac_code,
                sheet_count: mac.sheet_count,
                row_count: mac.row_count,
                updated_at: latest_change(conn, mac_id)?,
            })
        }
        None => None,
    };
    let taken = code_taken(
        conn,
        &code,
        same_mac.as_ref().map(|existing| existing.mac_id),
    )?;
    let linked: Vec<&FileLink> = file
        .sheets
        .iter()
        .filter_map(|sheet| sheet.google_link.as_ref())
        .filter(|link| !link.spreadsheet_id.trim().is_empty())
        .collect();
    let mut spreadsheets: Vec<PeekSheet> = Vec::new();
    for link in &linked {
        let id = link.spreadsheet_id.trim().to_string();
        let title = if link.spreadsheet_title.trim().is_empty() {
            "a Google Sheet".to_string()
        } else {
            link.spreadsheet_title.trim().to_string()
        };
        if !spreadsheets.iter().any(|sheet| sheet.id == id) {
            spreadsheets.push(PeekSheet { id, title });
        }
    }
    Ok(Peek {
        mac_name: file.mac.name.trim().to_string(),
        mac_code: code,
        mac_location: file.mac.location.clone(),
        exported_at: file.exported_at.clone(),
        sheets: file.sheets.len(),
        rows: file.sheets.iter().map(|sheet| sheet.rows.len()).sum(),
        links_only: file.links_only,
        linked_tables: linked.len(),
        spreadsheets,
        same_mac,
        code_taken: taken,
    })
}

/// When anything in a MAC (its details, a table, a row) last changed (UTC).
fn latest_change(conn: &Connection, mac_id: i64) -> CmdResult<String> {
    conn.query_row(
        "SELECT MAX(t) FROM (
            SELECT updated_at AS t FROM macs WHERE mac_id = ?1
            UNION ALL SELECT updated_at FROM sheets WHERE mac_id = ?1
            UNION ALL SELECT r.updated_at FROM sheet_rows r JOIN sheets s ON s.sheet_id = r.sheet_id
                WHERE s.mac_id = ?1)",
        [mac_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .map(|value| value.unwrap_or_default())
    .map_err(err)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub mac: Mac,
    pub sheets: usize,
    pub rows: usize,
    /// Tables linked to a Google Sheet: their rows are read from there next.
    pub linked: usize,
    /// Tables with neither a Google link nor rows: empty (the map is not one of them).
    pub empty: usize,
    /// This computer already had the file's code on another MAC, so the MAC got `mac.mac_code`.
    pub code_changed: bool,
    /// With `replace`: the MAC here that was taken out for it.
    pub replaced_mac_id: Option<i64>,
}

fn free_code(conn: &Connection, code: &str) -> CmdResult<String> {
    for n in 2..10_000 {
        let candidate = format!("{code}-{n}");
        if !code_taken(conn, &candidate, None)? {
            return Ok(candidate);
        }
    }
    Err("Couldn't find a free code for this MAC.".into())
}

/// Adds the file's MAC. `replace`: if this computer has the same MAC (same id inside the file),
/// it is taken out and the file's copy goes in its place; otherwise the file's MAC is added next
/// to what is here (a new code if its code is taken). All or nothing.
pub fn import(conn: &mut Connection, file: MacFile, replace: bool) -> CmdResult<Imported> {
    import_as(conn, file, replace, None)
}

/// `import`, for a signed-in account: only that account's own copy of the MAC can be replaced, and the new MAC is the
/// account's. (`None`: no accounts, as in tests.)
pub fn import_as(
    conn: &mut Connection,
    file: MacFile,
    replace: bool,
    account: Option<&str>,
) -> CmdResult<Imported> {
    check_header(&file)?;
    let (name, code) = check_mac(&mac_input(&file.mac))?;
    let tx = conn.transaction().map_err(err)?;

    let existing = existing_with_uuid(&tx, &file.mac.uuid, account)?;
    // Another account's MAC may have this id: this one is then a different MAC.
    let id_elsewhere = existing.is_none() && uuid_in_use(&tx, &file.mac.uuid)?;
    let mut replaced_mac_id = None;
    if let (true, Some(old)) = (replace, existing) {
        // Its view settings are keyed by table id; the cascade takes the tables themselves.
        for name in SHEET_SETTINGS {
            tx.execute(
                "DELETE FROM settings WHERE key IN
                    (SELECT 'sheet.' || sheet_id || '.' || ?2 FROM sheets WHERE mac_id = ?1)",
                params![old, name],
            )
            .map_err(err)?;
        }
        tx.execute("DELETE FROM macs WHERE mac_id = ?1", [old])
            .map_err(err)?;
        replaced_mac_id = Some(old);
    }
    let uuid = if file.mac.uuid.is_empty() || (existing.is_some() && !replace) || id_elsewhere {
        uuid::Uuid::new_v4().to_string()
    } else {
        file.mac.uuid.clone()
    };
    let (code, code_changed) = if code_taken(&tx, &code, None)? {
        (free_code(&tx, &code)?, true)
    } else {
        (code, false)
    };
    let crop = file.mac.crop.trim().to_string();
    tx.execute(
        "INSERT INTO macs (mac_uuid, mac_name, mac_code, mac_location, latitude, longitude,
            start_date, end_date, crop, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid,
            name,
            code,
            clean(&file.mac.location),
            file.mac.latitude,
            file.mac.longitude,
            clean(&file.mac.start_date),
            clean(&file.mac.end_date),
            if crop.is_empty() {
                "chili"
            } else {
                crop.as_str()
            },
            clean(&file.mac.note),
        ],
    )
    .map_err(err)?;
    let mac_id = tx.last_insert_rowid();
    if let Some(email) = account {
        crate::access::grant(&tx, mac_id, email)?;
    }

    let mut row_total = 0;
    let mut linked_total = 0;
    let mut empty_total = 0;
    let links_only = file.links_only;
    let sheet_total = file.sheets.len();
    for sheet in file.sheets {
        let title = check_title(&sheet.title)?;
        let heading = Some(sheet.heading.trim())
            .filter(|text| !text.is_empty())
            .unwrap_or("My tables");
        let sheet_id = insert_sheet_from(
            &tx,
            mac_id,
            &title,
            heading,
            sheet.icon.as_deref().filter(|icon| !icon.trim().is_empty()),
            sheet.about.trim(),
            sheet
                .template_key
                .as_deref()
                .filter(|key| !key.trim().is_empty()),
            sheet.columns,
            sheet.display_order,
            sheet.next_key,
        )?;
        if let Some(dashboard) = &sheet.dashboard {
            tx.execute(
                "UPDATE sheets SET dashboard = ?2 WHERE sheet_id = ?1",
                params![sheet_id, serde_json::to_string(dashboard).map_err(err)?],
            )
            .map_err(err)?;
        }
        // A links-only file brings no rows, whatever it holds: the data comes from Google. Only the map (the Zones table
        // with no Google link) is taken from the file.
        let is_map = sheet.template_key.as_deref() == Some("zones")
            && sheet
                .google_link
                .as_ref()
                .is_none_or(|link| link.spreadsheet_id.trim().is_empty());
        let mut rows = if links_only && !is_map { Vec::new() } else { sheet.rows };
        rows.sort_by(|a, b| a.position.total_cmp(&b.position));
        row_total += rows.len();
        let has_rows = !rows.is_empty();
        insert_rows(
            &tx,
            sheet_id,
            rows.into_iter().map(|row| row.data).collect(),
            None,
            None,
        )?;

        for (setting, value) in &sheet.settings {
            let sound = match setting.as_str() {
                "frozenColumns" => value.parse::<u32>().is_ok(),
                "conditionalFormats" => serde_json::from_str::<Value>(value).is_ok(),
                _ => false,
            };
            if sound {
                tx.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![format!("sheet.{sheet_id}.{setting}"), value],
                )
                .map_err(err)?;
            }
        }
        if let Some(link) = sheet
            .google_link
            .filter(|link| !link.spreadsheet_id.trim().is_empty())
        {
            // A layout that makes no sense is left out: the tab is found as it always was.
            let layout = link
                .layout
                .as_ref()
                .filter(|layout| layout.is_valid())
                .map(serde_json::to_string)
                .transpose()
                .map_err(err)?;
            tx.execute(
                "INSERT INTO google_links (sheet_id, spreadsheet_id, spreadsheet_title, tab_title,
                    header_map, last_synced_at, last_row_count, layout)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    sheet_id,
                    link.spreadsheet_id.trim(),
                    link.spreadsheet_title,
                    link.tab_title,
                    serde_json::to_string(&link.header_map).map_err(err)?,
                    if links_only { None } else { link.last_synced_at },
                    if links_only { 0 } else { link.last_row_count },
                    layout,
                ],
            )
            .map_err(err)?;
            linked_total += 1;
        } else if !has_rows {
            empty_total += 1;
        }
    }
    tx.commit().map_err(err)?;
    Ok(Imported {
        mac: load_mac(conn, mac_id)?,
        sheets: sheet_total,
        rows: row_total,
        linked: linked_total,
        empty: empty_total,
        code_changed,
        replaced_mac_id,
    })
}

fn clean(text: &Option<String>) -> Option<String> {
    text.as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

// -------------------------------------------------------------- commands

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub sheets: usize,
    /// Always 0: a saved file has no rows.
    pub rows: usize,
    pub bytes: u64,
    /// Tables in the file that are linked to a Google Sheet (read from there when it is opened).
    pub linked: usize,
    /// Tables that hold rows here but are not linked to Google: they arrive empty.
    pub empty_on_open: Vec<String>,
}

/// The tables of a MAC that have rows here and no Google link: a file can't carry them (the Zones table, the map, it can).
fn unlinked_with_rows(conn: &Connection, mac_id: i64) -> CmdResult<Vec<String>> {
    let mut statement = conn
        .prepare(
            "SELECT s.title FROM sheets s
             WHERE s.mac_id = ?1
               AND COALESCE(s.template_key, '') <> 'zones'
               AND NOT EXISTS (SELECT 1 FROM google_links l WHERE l.sheet_id = s.sheet_id)
               AND EXISTS (SELECT 1 FROM sheet_rows r WHERE r.sheet_id = s.sheet_id)
             ORDER BY s.display_order, s.sheet_id",
        )
        .map_err(err)?;
    let titles = statement
        .query_map([mac_id], |row| row.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(titles)
}

/// Writes a MAC's tables and their Google links, with no rows, to `path`.
#[tauri::command]
pub fn export_mac_file(
    db: State<'_, Db>,
    google: State<'_, crate::google::GoogleState>,
    mac_id: i64,
    path: String,
) -> CmdResult<Saved> {
    let (file, empty_on_open) = {
        let conn = db.conn.lock().map_err(err)?;
        crate::access::guard_mac(&conn, &google, mac_id)?;
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
    google: State<'_, crate::google::GoogleState>,
    path: String,
) -> CmdResult<Peek> {
    let email = crate::access::require(&google)?;
    let file = read(&path)?;
    let conn = db.conn.lock().map_err(err)?;
    peek(&conn, &file, Some(&email))
}

/// Adds the MAC in the file (see `import`).
#[tauri::command]
pub fn import_mac_file(
    db: State<'_, Db>,
    google: State<'_, crate::google::GoogleState>,
    path: String,
    replace: bool,
) -> CmdResult<Imported> {
    let email = crate::access::require(&google)?;
    let file = read(&path)?;
    let mut conn = db.conn.lock().map_err(err)?;
    import_as(&mut conn, file, replace, Some(&email))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::template;

    fn memory() -> Connection {
        let path =
            std::env::temp_dir().join(format!("ukmac-file-test-{}.db", uuid::Uuid::new_v4()));
        crate::db::open(&path).unwrap()
    }

    /// A MAC with the chili tables, a few Zones rows, a dashboard, view settings and a Google link.
    fn farm(conn: &mut Connection) -> i64 {
        conn.execute(
            "INSERT INTO macs (mac_uuid, mac_name, mac_code, mac_location, latitude, longitude)
             VALUES ('uuid-1', 'Pursat', 'MAC-001', 'Pursat', 12.5, 103.9)",
            [],
        )
        .unwrap();
        let mac_id = conn.last_insert_rowid();
        let tx = conn.transaction().unwrap();
        for (order, sheet) in template::chili_template().into_iter().enumerate() {
            insert_sheet_from(
                &tx,
                mac_id,
                sheet.title,
                sheet.heading,
                Some(sheet.icon),
                sheet.about,
                Some(sheet.key),
                sheet.columns,
                order as i64,
                1,
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let zones: i64 = conn
            .query_row(
                "SELECT sheet_id FROM sheets WHERE mac_id = ?1 AND template_key = 'zones'",
                [mac_id],
                |row| row.get(0),
            )
            .unwrap();
        let key_of = |name: &str| -> String {
            let columns: String = conn
                .query_row(
                    "SELECT columns FROM sheets WHERE sheet_id = ?1",
                    [zones],
                    |row| row.get(0),
                )
                .unwrap();
            let columns: Vec<Column> = serde_json::from_str(&columns).unwrap();
            columns
                .into_iter()
                .find(|column| column.name == name)
                .unwrap()
                .key
        };
        let (zone, plot) = (key_of("Zone"), key_of("Plot"));
        let tx = conn.transaction().unwrap();
        for plot_name in ["A1", "A2", "A3"] {
            let mut data = Map::new();
            data.insert(zone.clone(), Value::String("A".into()));
            data.insert(plot.clone(), Value::String(plot_name.into()));
            insert_rows(&tx, zones, vec![data], None, None).unwrap();
        }
        tx.commit().unwrap();
        // The middle row moved to the top, as a sort in the sheet would do.
        conn.execute(
            "UPDATE sheet_rows SET position = 0.5 WHERE sheet_id = ?1 AND data LIKE '%A2%'",
            [zones],
        )
        .unwrap();
        conn.execute("UPDATE sheets SET dashboard = '{\"kpis\":[{\"title\":\"Plots\"}]}', next_key = 40 WHERE sheet_id = ?1", [zones]).unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, '2')",
            [format!("sheet.{zones}.frozenColumns")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, '[{\"a\":1}]')",
            [format!("sheet.{zones}.conditionalFormats")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('powerbi.path', '/x/y.xlsx')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO google_links (sheet_id, spreadsheet_id, spreadsheet_title, tab_title, header_map, last_synced_at, last_row_count, layout)
             VALUES (?1, 'sheet-abc', 'Farm sheet', 'Zones', '{\"zone\":\"c1\"}', '2026-11-05 10:00:00', 3,
                     '{\"headerFrom\":2,\"headerTo\":3,\"dataFrom\":5}')",
            [zones],
        )
        .unwrap();
        mac_id
    }

    fn saved(conn: &Connection, mac_id: i64) -> MacFile {
        through_a_file(&build_full(conn, mac_id).unwrap())
    }

    fn through_a_file(file: &MacFile) -> MacFile {
        serde_json::from_slice(&serde_json::to_vec(file).unwrap()).unwrap()
    }

    fn zones_of(conn: &Connection, mac_id: i64) -> i64 {
        conn.query_row(
            "SELECT sheet_id FROM sheets WHERE mac_id = ?1 AND template_key = 'zones'",
            [mac_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_mac_comes_back_whole_on_another_computer() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        let file = through_a_file(&build_full(&here, mac_id).unwrap());
        assert_eq!(file.sheets.len(), 15);

        let mut there = memory();
        let done = import(&mut there, file, false).unwrap();
        assert_eq!(
            (
                done.sheets,
                done.rows,
                done.code_changed,
                done.replaced_mac_id
            ),
            (15, 3, false, None)
        );
        assert_eq!(done.mac.mac_uuid, "uuid-1");
        assert_eq!(done.mac.mac_code, "MAC-001");
        assert_eq!(done.mac.latitude, Some(12.5));

        // Zone Map finds its tables by template key; the keys, the order and the next key are kept.
        let zones = zones_of(&there, done.mac.mac_id);
        let old = load_sheets(&here, mac_id).unwrap();
        let new = load_sheets(&there, done.mac.mac_id).unwrap();
        assert_eq!(old.len(), new.len());
        for (a, b) in old.iter().zip(&new) {
            assert_eq!(
                (&a.title, &a.template_key, a.display_order),
                (&b.title, &b.template_key, b.display_order)
            );
            let keys = |s: &crate::model::Sheet| {
                s.columns
                    .iter()
                    .map(|c| (c.key.clone(), c.name.clone(), c.col_type.clone()))
                    .collect::<Vec<_>>()
            };
            assert_eq!(keys(a), keys(b));
            // The whole of each column comes back, not just its name and type: its box, group, formula and its
            // allowed values (min, max), or a MAC moved to another computer would lose them.
            assert_eq!(
                serde_json::to_value(&a.columns).unwrap(),
                serde_json::to_value(&b.columns).unwrap(),
                "{}",
                a.title
            );
        }
        let next_key: i64 = there
            .query_row(
                "SELECT next_key FROM sheets WHERE sheet_id = ?1",
                [zones],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next_key, 40);
        let rows = load_rows(&there, zones).unwrap();
        let plots: Vec<String> = rows
            .iter()
            .flat_map(|row| {
                row.data
                    .values()
                    .filter_map(|v| v.as_str())
                    .filter(|v| v.starts_with('A') && v.len() == 2)
                    .map(String::from)
            })
            .collect();
        assert_eq!(plots, ["A2", "A1", "A3"]);
        let dashboard: Option<String> = there
            .query_row(
                "SELECT dashboard FROM sheets WHERE sheet_id = ?1",
                [zones],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            dashboard.as_deref(),
            Some("{\"kpis\":[{\"title\":\"Plots\"}]}")
        );

        // The view settings follow the table to its new id; global ones stay behind.
        let setting = |key: String| -> Option<String> {
            there
                .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                    row.get(0)
                })
                .optional()
                .unwrap()
        };
        assert_eq!(
            setting(format!("sheet.{zones}.frozenColumns")).as_deref(),
            Some("2")
        );
        assert_eq!(
            setting(format!("sheet.{zones}.conditionalFormats")).as_deref(),
            Some("[{\"a\":1}]")
        );
        assert_eq!(setting("powerbi.path".into()), None);

        // The link to the Google Sheet is there, so the table can Sync once signed in.
        let linked = links::list(&there, Some(done.mac.mac_id)).unwrap();
        assert_eq!(linked.len(), 1);
        assert_eq!(
            (
                linked[0].sheet_id,
                linked[0].spreadsheet_id.as_str(),
                linked[0].tab_title.as_str()
            ),
            (zones, "sheet-abc", "Zones")
        );
        assert_eq!(
            linked[0].last_synced_at.as_deref(),
            Some("2026-11-05 10:00:00")
        );
        assert_eq!(
            linked[0].header_map.get("zone").and_then(|v| v.as_str()),
            Some("c1")
        );
        // Where its names and data are comes too: otherwise Sync there would read the tab another way and add columns.
        assert_eq!(
            linked[0].layout,
            Some(links::FileLayout {
                header_from: 2,
                header_to: 3,
                data_from: 5
            })
        );
    }

    #[test]
    fn a_link_without_a_layout_or_with_one_that_makes_no_sense_comes_back_with_none() {
        let mut here = memory();
        let mac_id = farm(&mut here);

        // A file saved before layouts has no such field.
        let mut text = serde_json::to_value(build_full(&here, mac_id).unwrap()).unwrap();
        for sheet in text["sheets"].as_array_mut().unwrap() {
            if let Some(link) = sheet
                .get_mut("googleLink")
                .and_then(|link| link.as_object_mut())
            {
                link.remove("layout");
            }
        }
        let old: MacFile = serde_json::from_value(text).unwrap();
        let mut there = memory();
        let done = import(&mut there, old, false).unwrap();
        assert_eq!(
            links::list(&there, Some(done.mac.mac_id)).unwrap()[0].layout,
            None
        );

        // A layout where the data starts inside the names is not kept.
        let mut file = saved(&here, mac_id);
        let link = file
            .sheets
            .iter_mut()
            .find_map(|sheet| sheet.google_link.as_mut())
            .unwrap();
        link.layout = Some(links::FileLayout {
            header_from: 3,
            header_to: 4,
            data_from: 4,
        });
        let mut elsewhere = memory();
        let done = import(&mut elsewhere, file, false).unwrap();
        assert_eq!(
            links::list(&elsewhere, Some(done.mac.mac_id)).unwrap()[0].layout,
            None
        );
    }

    #[test]
    fn a_column_added_after_the_import_never_takes_an_old_key() {
        let mut conn = memory();
        let mut file = MacFile {
            format: FORMAT.into(),
            version: VERSION,
            exported_at: String::new(),
            app: String::new(),
            links_only: false,
            mac: FileMac {
                uuid: String::new(),
                name: "Farm".into(),
                code: "F-1".into(),
                location: None,
                latitude: None,
                longitude: None,
                start_date: None,
                end_date: None,
                crop: "chili".into(),
                note: None,
            },
            sheets: Vec::new(),
        };
        let column = |key: &str, name: &str| {
            let mut column = Column::new(name, "text");
            column.key = key.into();
            column
        };
        let sheet = |title: &str, next_key: i64| FileSheet {
            title: title.into(),
            heading: String::new(),
            icon: None,
            about: String::new(),
            template_key: None,
            columns: vec![column("c1", "A"), column("c3", "B")],
            next_key,
            display_order: 0,
            dashboard: None,
            rows: Vec::new(),
            google_link: None,
            settings: BTreeMap::new(),
        };
        // A file that says 1 (or nothing useful) still starts after c3; one that says 9 keeps 9 (c5-c8 were deleted).
        file.sheets = vec![sheet("Low", 1), sheet("High", 9)];
        let done = import(&mut conn, file, false).unwrap();
        let next: Vec<i64> = {
            let mut statement = conn
                .prepare(
                    "SELECT next_key FROM sheets WHERE mac_id = ?1 ORDER BY display_order, title",
                )
                .unwrap();
            statement
                .query_map([done.mac.mac_id], |row| row.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert_eq!(next, [9, 4]);
    }

    #[test]
    fn importing_the_same_mac_again_adds_a_copy_or_replaces_it() {
        let mut conn = memory();
        let mac_id = farm(&mut conn);

        let peeked = peek(&conn, &saved(&conn, mac_id), None).unwrap();
        assert_eq!(peeked.same_mac.as_ref().map(|m| m.mac_id), Some(mac_id));
        assert!(!peeked.code_taken, "its own code is not a clash");

        // Keep both: a new uuid and a free code, the first one untouched.
        let again = saved(&conn, mac_id);
        let copy = import(&mut conn, again, false).unwrap();
        assert!(copy.code_changed);
        assert_eq!(copy.mac.mac_code, "MAC-001-2");
        assert_ne!(copy.mac.mac_uuid, "uuid-1");
        assert_eq!(load_mac(&conn, mac_id).unwrap().mac_code, "MAC-001");
        let copy_zones = zones_of(&conn, copy.mac.mac_id);
        let own: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [format!("sheet.{copy_zones}.frozenColumns")],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(own.as_deref(), Some("2"));

        // Replace: the old one goes (with its view settings), the file's copy takes its code back.
        let old_zones = zones_of(&conn, mac_id);
        let again = saved(&conn, mac_id);
        let replaced = import(&mut conn, again, true).unwrap();
        assert_eq!(replaced.replaced_mac_id, Some(mac_id));
        assert_eq!(replaced.mac.mac_uuid, "uuid-1");
        assert_eq!(replaced.mac.mac_code, "MAC-001");
        assert!(!replaced.code_changed);
        assert!(load_mac(&conn, mac_id).is_err());
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = ?1",
                [format!("sheet.{old_zones}.frozenColumns")],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
        let macs: i64 = conn
            .query_row("SELECT COUNT(*) FROM macs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(macs, 2);
    }

    #[test]
    fn a_file_on_disk_keeps_khmer_text_and_refuses_what_is_not_a_mac_file() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        here.execute(
            "UPDATE macs SET mac_name = 'ពោធិ៍សាត់ ១', note = 'ចម្ការម្ទេស' WHERE mac_id = ?1",
            [mac_id],
        )
        .unwrap();
        let path = std::env::temp_dir().join(format!("ukmac-{}.ukmac", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            serde_json::to_vec(&build_full(&here, mac_id).unwrap()).unwrap(),
        )
        .unwrap();

        let mut there = memory();
        let done = import(&mut there, read(path.to_str().unwrap()).unwrap(), false).unwrap();
        assert_eq!(done.mac.mac_name, "ពោធិ៍សាត់ ១");
        assert_eq!(done.mac.note.as_deref(), Some("ចម្ការម្ទេស"));

        std::fs::write(&path, "{\"hello\": 1}").unwrap();
        assert!(
            read(path.to_str().unwrap())
                .unwrap_err()
                .contains("isn't a MAC file")
        );
        std::fs::write(&path, "not json at all").unwrap();
        assert!(read(path.to_str().unwrap()).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_bad_file_is_refused_and_nothing_is_half_imported() {
        let mut conn = memory();
        let mac_id = farm(&mut conn);
        let mut file = through_a_file(&build_full(&conn, mac_id).unwrap());
        file.format = "something-else".into();
        assert!(
            import(&mut conn, file, false)
                .unwrap_err()
                .contains("isn't a MAC file")
        );

        let mut newer = through_a_file(&build_full(&conn, mac_id).unwrap());
        newer.version = VERSION + 1;
        assert!(
            import(&mut conn, newer, false)
                .unwrap_err()
                .contains("newer")
        );

        // The third table's name is bad: the MAC and the two tables before it must not stay.
        let mut broken = through_a_file(&build_full(&conn, mac_id).unwrap());
        broken.mac.uuid = "uuid-2".into();
        broken.mac.code = "MAC-002".into();
        broken.sheets[2].title = "Bad [name]".into();
        assert!(import(&mut conn, broken, false).is_err());
        let macs: i64 = conn
            .query_row("SELECT COUNT(*) FROM macs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(macs, 1);
    }

    #[test]
    fn a_saved_file_carries_no_rows_and_no_location() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        let file = build(&here, mac_id).unwrap();
        assert_eq!(file.version, VERSION);
        assert!(file.links_only);
        assert!(file.sheets.iter().all(|sheet| sheet.rows.is_empty()));
        assert_eq!(
            (file.mac.location.clone(), file.mac.latitude, file.mac.longitude),
            (None, None, None)
        );
        // Nothing of the farm's data is anywhere in the bytes: not a plot name, not the place.
        let text = String::from_utf8(serde_json::to_vec(&file).unwrap()).unwrap();
        for secret in ["\"A1\"", "\"A2\"", "\"A3\"", "12.5", "103.9", "Pursat\"", "2026-11-05"] {
            assert!(
                !text.contains(&secret.replace("Pursat\"", "\"location\":\"Pursat\"")),
                "the file holds {secret}"
            );
        }
        // The Google link is what travels, without when it was last read.
        let zones = file
            .sheets
            .iter()
            .find(|sheet| sheet.template_key.as_deref() == Some("zones"))
            .unwrap();
        let link = zones.google_link.as_ref().unwrap();
        assert_eq!(link.spreadsheet_id, "sheet-abc");
        assert_eq!((link.last_synced_at.clone(), link.last_row_count), (None, 0));
        assert!(link.layout.is_some());
    }

    #[test]
    fn opening_a_link_file_brings_the_tables_and_links_but_never_rows() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        let mut file = through_a_file(&build(&here, mac_id).unwrap());
        // Even a file that was tampered with to hold rows gets none in.
        let mut data = Map::new();
        data.insert("c1".into(), Value::String("smuggled".into()));
        file.sheets[0].rows.push(FileRow { position: 1.0, data });
        let peek_here = memory();
        let peek = peek(&peek_here, &file, None).unwrap();
        assert!(peek.links_only);
        assert_eq!(
            (peek.linked_tables, peek.spreadsheets.clone()),
            (1, vec![PeekSheet { id: "sheet-abc".into(), title: "Farm sheet".into() }])
        );

        let mut there = memory();
        let done = import(&mut there, file, false).unwrap();
        assert_eq!((done.sheets, done.rows, done.linked), (15, 0, 1));
        let rows: i64 = there
            .query_row("SELECT COUNT(*) FROM sheet_rows", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        let (synced, count): (Option<String>, i64) = there
            .query_row(
                "SELECT last_synced_at, last_row_count FROM google_links",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((synced, count), (None, 0));
        // Zone Map still finds its table.
        assert_eq!(zones_of(&there, done.mac.mac_id) > 0, true);
    }

    #[test]
    fn it_says_which_tables_with_data_will_arrive_empty_but_not_the_map() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        // Zones has rows and a link here: nothing is lost. Take the link off and it still travels: it is the map.
        here.execute("DELETE FROM google_links", []).unwrap();
        assert!(unlinked_with_rows(&here, mac_id).unwrap().is_empty());
        // Any other table with rows and no link is listed.
        let other: i64 = here
            .query_row(
                "SELECT sheet_id FROM sheets WHERE mac_id = ?1 AND COALESCE(template_key, '') <> 'zones' ORDER BY sheet_id LIMIT 1",
                [mac_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut data = Map::new();
        data.insert("c1".into(), Value::String("x".into()));
        let tx = here.transaction().unwrap();
        insert_rows(&tx, other, vec![data], None, None).unwrap();
        tx.commit().unwrap();
        assert_eq!(unlinked_with_rows(&here, mac_id).unwrap(), vec![other_title(&here, other)]);
    }

    #[test]
    fn another_account_never_sees_or_replaces_the_first_accounts_copy() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        crate::access::grant(&here, mac_id, "owner@gmail.com").unwrap();
        let file = through_a_file(&build(&here, mac_id).unwrap());

        // The owner's own copy is found, and Replace is theirs to choose.
        let own = peek(&here, &file, Some("Owner@gmail.com")).unwrap();
        assert_eq!(own.same_mac.map(|existing| existing.mac_id), Some(mac_id));
        // Another account on this computer is told nothing of it.
        let other = peek(&here, &file, Some("other@gmail.com")).unwrap();
        assert!(other.same_mac.is_none());

        // Its import, even asking for Replace, adds a separate MAC of its own and leaves the owner's alone.
        let done = import_as(&mut here, file, true, Some("other@gmail.com")).unwrap();
        assert_eq!(done.replaced_mac_id, None);
        assert_ne!(done.mac.mac_id, mac_id);
        assert_ne!(done.mac.mac_uuid, "uuid-1");
        assert!(crate::access::owns(&here, "other@gmail.com", done.mac.mac_id).unwrap());
        assert!(!crate::access::owns(&here, "other@gmail.com", mac_id).unwrap());
        assert!(crate::access::owns(&here, "owner@gmail.com", mac_id).unwrap());
        let still: i64 = here
            .query_row("SELECT COUNT(*) FROM sheets WHERE mac_id = ?1", [mac_id], |row| row.get(0))
            .unwrap();
        assert_eq!(still, 15);
    }

    #[test]
    fn the_map_travels_in_the_file_and_nothing_else_does() {
        let mut here = memory();
        let mac_id = farm(&mut here);
        // The zones are not in Google (no link), and another table has a row of its own.
        here.execute("DELETE FROM google_links", []).unwrap();
        let other: i64 = here
            .query_row(
                "SELECT sheet_id FROM sheets WHERE mac_id = ?1 AND COALESCE(template_key, '') <> 'zones' ORDER BY sheet_id LIMIT 1",
                [mac_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut data = Map::new();
        data.insert("c1".into(), Value::String("Secret batch B7".into()));
        let tx = here.transaction().unwrap();
        insert_rows(&tx, other, vec![data], None, None).unwrap();
        tx.commit().unwrap();

        let file = build(&here, mac_id).unwrap();
        for sheet in &file.sheets {
            let is_map = sheet.template_key.as_deref() == Some("zones");
            assert_eq!(sheet.rows.len(), if is_map { 3 } else { 0 }, "{}", sheet.title);
        }
        let text = String::from_utf8(serde_json::to_vec(&file).unwrap()).unwrap();
        assert!(text.contains("\"A2\""), "the plots are in the file");
        assert!(!text.contains("Secret batch B7"), "no other table's rows");
        // The farm's own place still does not travel, and the save does not list the map as one that arrives empty.
        assert_eq!((file.mac.latitude, file.mac.longitude), (None, None));
        assert_eq!(unlinked_with_rows(&here, mac_id).unwrap(), vec![other_title(&here, other)]);

        // Opened elsewhere: the map's rows come, the other table's do not, and the tables left empty are counted.
        let mut there = memory();
        let done = import(&mut there, through_a_file(&file), false).unwrap();
        assert_eq!((done.sheets, done.rows, done.linked), (15, 3, 0));
        assert_eq!(done.empty, 14);
        let zones = zones_of(&there, done.mac.mac_id);
        let plots: i64 = there
            .query_row("SELECT COUNT(*) FROM sheet_rows WHERE sheet_id = ?1", [zones], |row| row.get(0))
            .unwrap();
        assert_eq!(plots, 3);
        let total: i64 = there.query_row("SELECT COUNT(*) FROM sheet_rows", [], |row| row.get(0)).unwrap();
        assert_eq!(total, 3);
    }

    #[test]
    fn a_zones_table_that_is_in_google_goes_by_its_link_not_by_rows() {
        let mut here = memory();
        let mac_id = farm(&mut here); // Zones is linked to a Google Sheet
        let file = build(&here, mac_id).unwrap();
        assert!(file.sheets.iter().all(|sheet| sheet.rows.is_empty()));
    }

    fn other_title(conn: &Connection, sheet_id: i64) -> String {
        conn.query_row("SELECT title FROM sheets WHERE sheet_id = ?1", [sheet_id], |row| row.get(0))
            .unwrap()
    }
}
