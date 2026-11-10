//! Which local tables mirror which tab of a Google Sheet: the sheet's id and name, the tab, when
//! it was last read, and which of the table's columns each header of the tab went to (so renaming
//! a column here doesn't make the next sync add the old name back).
//!
//! A link belongs to its table: deleting the table (or its MAC) takes the link with it.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use crate::commands::Db;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

/// Where a tab's column names and its data are, when the person said (worksheet rows, from 1): the
/// names take `header_from` to `header_to`, the data starts at `data_from`. A link with none finds
/// them as it always did.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLayout {
    pub header_from: i64,
    pub header_to: i64,
    pub data_from: i64,
}

impl FileLayout {
    /// Rows that make sense: the names at least one row, a few at most, the data after them.
    pub(crate) fn is_valid(&self) -> bool {
        self.header_from >= 1
            && self.header_to >= self.header_from
            && self.header_to - self.header_from < 4
            && self.data_from > self.header_to
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleLink {
    pub link_id: i64,
    pub sheet_id: i64,
    pub mac_id: i64,
    pub mac_name: String,
    pub table_title: String,
    pub spreadsheet_id: String,
    pub spreadsheet_title: String,
    pub tab_title: String,
    /// The tab's header (as `normalizeHeader` writes it) → the table column's key.
    pub header_map: Map<String, Value>,
    /// When it was last read (UTC, `YYYY-MM-DD HH:MM:SS`), if ever.
    pub last_synced_at: Option<String>,
    pub last_row_count: i64,
    /// Where the tab's names and data are, when the person said; else they're found on each read.
    pub layout: Option<FileLayout>,
    /// `app`: the sheet was made from this table by Save a link file, and is written from here (the table is not read from it).
    pub origin: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleLinkInput {
    pub sheet_id: i64,
    pub spreadsheet_id: String,
    pub spreadsheet_title: String,
    pub tab_title: String,
    #[serde(default)]
    pub header_map: Map<String, Value>,
    /// Rows the table has just been filled with (the first read).
    #[serde(default)]
    pub row_count: Option<i64>,
    /// Where the tab's names and data are, when the person said (none: found on each read).
    #[serde(default)]
    pub layout: Option<FileLayout>,
    /// `app`: the sheet is made and kept by this app from the table (see `GoogleLink::origin`).
    #[serde(default)]
    pub origin: Option<String>,
}

const SELECT: &str = "SELECT l.link_id, l.sheet_id, s.mac_id, m.mac_name, s.title,
        l.spreadsheet_id, l.spreadsheet_title, l.tab_title, l.header_map,
        l.last_synced_at, l.last_row_count, l.layout, l.origin
    FROM google_links l
    JOIN sheets s ON s.sheet_id = l.sheet_id
    JOIN macs m ON m.mac_id = s.mac_id";

fn link_from_row(row: &rusqlite::Row) -> rusqlite::Result<GoogleLink> {
    let header_map: String = row.get(8)?;
    Ok(GoogleLink {
        link_id: row.get(0)?,
        sheet_id: row.get(1)?,
        mac_id: row.get(2)?,
        mac_name: row.get(3)?,
        table_title: row.get(4)?,
        spreadsheet_id: row.get(5)?,
        spreadsheet_title: row.get(6)?,
        tab_title: row.get(7)?,
        header_map: serde_json::from_str(&header_map).unwrap_or_default(),
        last_synced_at: row.get(9)?,
        last_row_count: row.get(10)?,
        // A layout that can't be read (or makes no sense) is none: the tab is found as it always was.
        layout: row
            .get::<_, Option<String>>(11)?
            .and_then(|text| serde_json::from_str::<FileLayout>(&text).ok())
            .filter(FileLayout::is_valid),
        origin: row.get(12)?,
    })
}

fn link_of(conn: &Connection, sheet_id: i64) -> CmdResult<GoogleLink> {
    conn.query_row(
        &format!("{SELECT} WHERE l.sheet_id = ?1"),
        [sheet_id],
        link_from_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "That table isn't linked to a Google Sheet.".to_string())
}

pub fn list(conn: &Connection, mac_id: Option<i64>) -> CmdResult<Vec<GoogleLink>> {
    let mut statement = conn
        .prepare(&format!(
            "{SELECT} WHERE (?1 IS NULL OR s.mac_id = ?1) ORDER BY m.mac_name, s.display_order, s.sheet_id"
        ))
        .map_err(err)?;
    let links = statement
        .query_map([mac_id], link_from_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(links)
}

/// Links a table to a tab (or points its link at another tab). With `row_count`, the table has
/// just been read from it.
pub fn save(conn: &Connection, input: &GoogleLinkInput) -> CmdResult<GoogleLink> {
    let header_map = serde_json::to_string(&input.header_map).map_err(err)?;
    if input
        .layout
        .as_ref()
        .is_some_and(|layout| !layout.is_valid())
    {
        return Err("The rows of the column names and of the data don't make sense: the names come first, then the data.".into());
    }
    let layout = input
        .layout
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(err)?;
    let exists: Option<i64> = conn
        .query_row(
            "SELECT sheet_id FROM sheets WHERE sheet_id = ?1",
            [input.sheet_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if exists.is_none() {
        return Err("That table doesn't exist any more.".into());
    }
    conn.execute(
        "INSERT INTO google_links (sheet_id, spreadsheet_id, spreadsheet_title, tab_title, header_map,
                                   last_synced_at, last_row_count, layout, origin)
         VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?6 IS NULL THEN NULL ELSE datetime('now') END, COALESCE(?6, 0), ?7, ?8)
         ON CONFLICT(sheet_id) DO UPDATE SET
             spreadsheet_id = excluded.spreadsheet_id,
             spreadsheet_title = excluded.spreadsheet_title,
             tab_title = excluded.tab_title,
             header_map = excluded.header_map,
             last_synced_at = excluded.last_synced_at,
             last_row_count = excluded.last_row_count,
             layout = excluded.layout,
             origin = excluded.origin",
        params![
            input.sheet_id,
            input.spreadsheet_id,
            input.spreadsheet_title,
            input.tab_title,
            header_map,
            input.row_count,
            layout,
            input.origin
        ],
    )
    .map_err(err)?;
    link_of(conn, input.sheet_id)
}

/// A read of the tab just finished: when, how many rows, and where each header went.
pub fn synced(
    conn: &Connection,
    sheet_id: i64,
    row_count: i64,
    header_map: &Map<String, Value>,
) -> CmdResult<GoogleLink> {
    let header_map = serde_json::to_string(header_map).map_err(err)?;
    let changed = conn
        .execute(
            "UPDATE google_links SET last_synced_at = datetime('now'), last_row_count = ?2, header_map = ?3
             WHERE sheet_id = ?1",
            params![sheet_id, row_count, header_map],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err("That table isn't linked to a Google Sheet.".into());
    }
    link_of(conn, sheet_id)
}

pub fn remove(conn: &Connection, sheet_id: i64) -> CmdResult<()> {
    conn.execute("DELETE FROM google_links WHERE sheet_id = ?1", [sheet_id])
        .map_err(err)?;
    Ok(())
}

/// Only the signed-in account's own MACs' links (the others' sheet and table names stay unseen).
#[tauri::command]
pub fn list_google_links(
    db: State<'_, Db>,
    google: State<'_, crate::google::GoogleState>,
    mac_id: Option<i64>,
) -> CmdResult<Vec<GoogleLink>> {
    let Some(email) = google.account() else {
        return Ok(Vec::new());
    };
    let conn = db.conn.lock().map_err(err)?;
    let owned = crate::access::owned(&conn, &email)?;
    Ok(list(&conn, mac_id)?
        .into_iter()
        .filter(|link| owned.contains(&link.mac_id))
        .collect())
}

#[tauri::command]
pub fn save_google_link(
    db: State<'_, Db>,
    google: State<'_, crate::google::GoogleState>,
    input: GoogleLinkInput,
) -> CmdResult<GoogleLink> {
    let conn = db.conn.lock().map_err(err)?;
    crate::access::guard_sheet(&conn, &google, input.sheet_id)?;
    save(&conn, &input)
}

#[tauri::command]
pub fn google_link_synced(
    db: State<'_, Db>,
    google: State<'_, crate::google::GoogleState>,
    sheet_id: i64,
    row_count: i64,
    header_map: Map<String, Value>,
) -> CmdResult<GoogleLink> {
    let conn = db.conn.lock().map_err(err)?;
    crate::access::guard_sheet(&conn, &google, sheet_id)?;
    synced(&conn, sheet_id, row_count, &header_map)
}

#[tauri::command]
pub fn delete_google_link(
    db: State<'_, Db>,
    google: State<'_, crate::google::GoogleState>,
    sheet_id: i64,
) -> CmdResult<()> {
    let conn = db.conn.lock().map_err(err)?;
    crate::access::guard_sheet(&conn, &google, sheet_id)?;
    remove(&conn, sheet_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn database() -> Connection {
        let path = std::env::temp_dir().join(format!("ukmac-links-{}.db", uuid::Uuid::new_v4()));
        db::open(&path).unwrap()
    }

    fn table(conn: &Connection, mac: &str, title: &str) -> i64 {
        conn.execute(
            "INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES (?1, ?2, ?3)",
            params![uuid::Uuid::new_v4().to_string(), mac, mac],
        )
        .ok();
        let mac_id: i64 = conn
            .query_row(
                "SELECT mac_id FROM macs WHERE mac_code = ?1",
                [mac],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO sheets (mac_id, title) VALUES (?1, ?2)",
            params![mac_id, title],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn input(sheet_id: i64, tab: &str, row_count: Option<i64>) -> GoogleLinkInput {
        let mut header_map = Map::new();
        header_map.insert("plot".into(), Value::String("c1".into()));
        GoogleLinkInput {
            sheet_id,
            spreadsheet_id: "1AbC".into(),
            spreadsheet_title: "Chili farm".into(),
            tab_title: tab.into(),
            header_map,
            row_count,
            layout: None,
            origin: None,
        }
    }

    #[test]
    fn a_table_is_linked_read_and_unlinked() {
        let conn = database();
        let zones = table(&conn, "MAC-001", "Zones");
        let batches = table(&conn, "MAC-002", "Batches");

        let link = save(&conn, &input(zones, "Zones tab", Some(12))).unwrap();
        assert_eq!(link.table_title, "Zones");
        assert_eq!(link.mac_name, "MAC-001");
        assert_eq!(link.last_row_count, 12);
        assert!(link.last_synced_at.is_some());
        assert_eq!(link.header_map["plot"], "c1");

        // Linked but not read yet.
        let fresh = save(&conn, &input(batches, "Batches", None)).unwrap();
        assert!(fresh.last_synced_at.is_none());

        // Linking the same table again points the link elsewhere, it doesn't make a second one.
        save(&conn, &input(zones, "Another tab", Some(3))).unwrap();
        assert_eq!(list(&conn, None).unwrap().len(), 2);
        assert_eq!(list(&conn, Some(link.mac_id)).unwrap().len(), 1);
        assert_eq!(link_of(&conn, zones).unwrap().tab_title, "Another tab");

        let mut map = Map::new();
        map.insert("plot".into(), Value::String("c1".into()));
        map.insert("area".into(), Value::String("c2".into()));
        let read = synced(&conn, batches, 40, &map).unwrap();
        assert_eq!(read.last_row_count, 40);
        assert_eq!(read.header_map.len(), 2);
        assert!(read.last_synced_at.is_some());

        remove(&conn, zones).unwrap();
        assert!(link_of(&conn, zones).is_err());
        assert!(synced(&conn, zones, 1, &Map::new()).is_err());
    }

    #[test]
    fn deleting_the_table_deletes_its_link() {
        let conn = database();
        let zones = table(&conn, "MAC-001", "Zones");
        save(&conn, &input(zones, "Zones", Some(1))).unwrap();
        conn.execute("DELETE FROM sheets WHERE sheet_id = ?1", [zones])
            .unwrap();
        assert!(list(&conn, None).unwrap().is_empty());
        assert!(save(&conn, &input(zones, "Zones", None)).is_err());
    }

    #[test]
    fn a_layout_is_kept_with_the_link_and_a_link_without_one_has_none() {
        let conn = database();
        let nursery = table(&conn, "MAC-001", "Nursery");

        let plain = save(&conn, &input(nursery, "Nursery", Some(5))).unwrap();
        assert_eq!(plain.layout, None);

        let layout = FileLayout {
            header_from: 2,
            header_to: 3,
            data_from: 5,
        };
        let mut with = input(nursery, "Nursery", Some(5));
        with.layout = Some(layout.clone());
        assert_eq!(save(&conn, &with).unwrap().layout, Some(layout.clone()));
        assert_eq!(list(&conn, None).unwrap()[0].layout, Some(layout.clone()));

        // A read of the tab doesn't forget it.
        let read = synced(&conn, nursery, 9, &Map::new()).unwrap();
        assert_eq!(read.layout, Some(layout));

        // Saved again with none, the layout is gone (the tab is found as before).
        assert_eq!(
            save(&conn, &input(nursery, "Nursery", None))
                .unwrap()
                .layout,
            None
        );
    }

    #[test]
    fn a_layout_that_makes_no_sense_is_refused_and_one_that_cannot_be_read_is_none() {
        let conn = database();
        let nursery = table(&conn, "MAC-001", "Nursery");
        for (from, to, data) in [(0, 1, 2), (3, 2, 4), (2, 3, 3), (1, 6, 7)] {
            let mut bad = input(nursery, "Nursery", None);
            bad.layout = Some(FileLayout {
                header_from: from,
                header_to: to,
                data_from: data,
            });
            assert!(save(&conn, &bad).is_err(), "{from} {to} {data}");
        }
        assert!(link_of(&conn, nursery).is_err());

        save(&conn, &input(nursery, "Nursery", None)).unwrap();
        conn.execute(
            "UPDATE google_links SET layout = 'not json' WHERE sheet_id = ?1",
            [nursery],
        )
        .unwrap();
        assert_eq!(link_of(&conn, nursery).unwrap().layout, None);
        conn.execute(
            "UPDATE google_links SET layout = '{\"headerFrom\":5,\"headerTo\":2,\"dataFrom\":3}' WHERE sheet_id = ?1",
            [nursery],
        )
        .unwrap();
        assert_eq!(link_of(&conn, nursery).unwrap().layout, None);
    }

    #[test]
    fn a_link_made_by_the_app_says_so_until_the_person_points_it_elsewhere() {
        let conn = database();
        let sheet = table(&conn, "MAC-001", "Zones");
        let mut made = input(sheet, "Zones", Some(3));
        made.origin = Some("app".into());
        assert_eq!(save(&conn, &made).unwrap().origin.as_deref(), Some("app"));
        // Pointed at another tab by hand, it is an ordinary link again.
        let by_hand = input(sheet, "Other", None);
        assert_eq!(save(&conn, &by_hand).unwrap().origin, None);
    }
}
