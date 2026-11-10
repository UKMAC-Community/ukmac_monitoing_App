//! The local database: one SQLite file in the app's data folder
//! (`~/Library/Application Support/com.ukmac.monitoring/ukmac.db`).
//!
//! There is no server: a MAC (farm), its tables and their rows all live
//! here. A table is sheet-like — its columns are a JSON list on the table,
//! a row's cells a JSON object keyed by column key (`c1`, `c2`, …; a key is
//! never given twice, so renaming or moving a column keeps its data).

use std::path::Path;

use rusqlite::Connection;

/// Each entry moves the database up one version (`PRAGMA user_version`).
const MIGRATIONS: &[&str] = &[
    // 1: MACs, their tables, rows, imports, settings.
    r#"
    CREATE TABLE macs (
        mac_id        INTEGER PRIMARY KEY AUTOINCREMENT,
        mac_uuid      TEXT NOT NULL UNIQUE,
        mac_name      TEXT NOT NULL,
        mac_code      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        mac_location  TEXT,
        latitude      REAL,
        longitude     REAL,
        start_date    TEXT,
        end_date      TEXT,
        crop          TEXT NOT NULL DEFAULT 'chili',
        note          TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sheets (
        sheet_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        mac_id        INTEGER NOT NULL REFERENCES macs(mac_id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        heading       TEXT NOT NULL DEFAULT 'My tables',
        icon          TEXT,
        about         TEXT NOT NULL DEFAULT '',
        template_key  TEXT,
        columns       TEXT NOT NULL DEFAULT '[]',
        next_key      INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX ux_sheets_mac_title ON sheets(mac_id, title COLLATE NOCASE);

    CREATE TABLE imports (
        import_id     INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id      INTEGER NOT NULL REFERENCES sheets(sheet_id) ON DELETE CASCADE,
        file_name     TEXT NOT NULL,
        mode          TEXT NOT NULL DEFAULT 'append',
        row_count     INTEGER NOT NULL DEFAULT 0,
        imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sheet_rows (
        row_id        INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id      INTEGER NOT NULL REFERENCES sheets(sheet_id) ON DELETE CASCADE,
        position      REAL NOT NULL,
        data          TEXT NOT NULL DEFAULT '{}',
        import_id     INTEGER REFERENCES imports(import_id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX ix_sheet_rows_sheet ON sheet_rows(sheet_id, position);
    CREATE INDEX ix_sheet_rows_import ON sheet_rows(import_id);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // 2: a table's dashboard (its KPI cards, charts and summaries; null: the suggested ones).
    r#"
    ALTER TABLE sheets ADD COLUMN dashboard TEXT;
    "#,
    // 3: a table kept in step with a tab of a Google Sheet (src/links.rs).
    r#"
    CREATE TABLE google_links (
        link_id           INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id          INTEGER NOT NULL UNIQUE REFERENCES sheets(sheet_id) ON DELETE CASCADE,
        spreadsheet_id    TEXT NOT NULL,
        spreadsheet_title TEXT NOT NULL,
        tab_title         TEXT NOT NULL,
        header_map        TEXT NOT NULL DEFAULT '{}',
        last_synced_at    TEXT,
        last_row_count    INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    "#,
    // 4: where a linked tab's column names and data are, when the person said (null: found as before).
    r#"
    ALTER TABLE google_links ADD COLUMN layout TEXT;
    "#,
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let target = index as i64 + 1;
        if version >= target {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {target}"))?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A database saved by the version before the layout column: its link is kept, and reads with no layout.
    #[test]
    fn a_link_saved_before_layouts_is_kept_and_has_none() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for sql in &MIGRATIONS[..3] {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute_batch("PRAGMA user_version = 3").unwrap();
        conn.execute_batch(
            "INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'MAC-001', 'MAC-001');
             INSERT INTO sheets (mac_id, title) VALUES (1, 'Zones');
             INSERT INTO google_links (sheet_id, spreadsheet_id, spreadsheet_title, tab_title, header_map)
             VALUES (1, '1AbC', 'Chili farm', 'Zones', '{\"plot\":\"c1\"}');",
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let (tab, layout): (String, Option<String>) = conn
            .query_row(
                "SELECT tab_title, layout FROM google_links WHERE sheet_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(tab, "Zones");
        assert_eq!(layout, None);
    }
}
