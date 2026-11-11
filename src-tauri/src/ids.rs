//! Automatic IDs: a column marked `auto` (the template's "ID") is numbered by the app, 1, 2, 3… in each table.
//!
//! A new row gets the next number as it is added; a number is never used twice in its table, not even after
//! the row that had it is deleted (the last number given is kept in `settings`, beside the table's own highest);
//! it is never typed and never changed (an edit to it is dropped); and rows that have none yet (a table that has
//! just gained the column, or was saved before it) are numbered in the order they are shown.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::model::Column;

fn counter_key(sheet_id: i64) -> String {
    format!("row-id:{sheet_id}")
}

/// The key of the table's auto column, if it has one.
pub fn auto_key(conn: &Connection, sheet_id: i64) -> rusqlite::Result<Option<String>> {
    let columns: Option<String> = conn
        .query_row(
            "SELECT columns FROM sheets WHERE sheet_id = ?1",
            [sheet_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(columns
        .and_then(|text| serde_json::from_str::<Vec<Column>>(&text).ok())
        .and_then(|columns| columns.into_iter().find(|column| column.auto).map(|column| column.key)))
}

/// A cell's number (cells are kept as text, "7"), if it holds one.
fn number_of(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::String(text) => text.trim().parse().ok(),
        Value::Number(number) => number.as_i64(),
        _ => None,
    }
}

/// The highest number given so far in the table: what was given before, or what its rows hold.
fn highest(conn: &Connection, sheet_id: i64, key: &str) -> rusqlite::Result<i64> {
    let given: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [counter_key(sheet_id)],
            |row| row.get(0),
        )
        .optional()?;
    let held: Option<i64> = conn.query_row(
        "SELECT MAX(CAST(json_extract(data, ?2) AS INTEGER)) FROM sheet_rows WHERE sheet_id = ?1",
        params![sheet_id, format!("$.{key}")],
        |row| row.get(0),
    )?;
    Ok(given.and_then(|text| text.parse().ok()).unwrap_or(0).max(held.unwrap_or(0)))
}

fn remember(conn: &Connection, sheet_id: i64, last: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![counter_key(sheet_id), last.to_string()],
    )?;
    Ok(())
}

/// Numbers the rows about to be added that have no ID (a row that comes with one, from a saved file, keeps it).
pub fn assign(conn: &Connection, sheet_id: i64, rows: &mut [Map<String, Value>]) -> rusqlite::Result<()> {
    let Some(key) = auto_key(conn, sheet_id)? else {
        return Ok(());
    };
    let mut last = highest(conn, sheet_id, &key)?;
    for row in rows.iter() {
        if let Some(number) = number_of(row.get(&key)) {
            last = last.max(number);
        }
    }
    for row in rows.iter_mut() {
        if number_of(row.get(&key)).is_none() {
            last += 1;
            row.insert(key.clone(), Value::String(last.to_string()));
        }
    }
    remember(conn, sheet_id, last)
}

/// Numbers the table's rows that have no ID, in the order they are shown, after the highest there is.
pub fn fill_missing(conn: &Connection, sheet_id: i64) -> rusqlite::Result<()> {
    let Some(key) = auto_key(conn, sheet_id)? else {
        return Ok(());
    };
    let mut last = highest(conn, sheet_id, &key)?;
    let rows: Vec<(i64, String)> = conn
        .prepare("SELECT row_id, data FROM sheet_rows WHERE sheet_id = ?1 ORDER BY position, row_id")?
        .query_map([sheet_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (row_id, data) in rows {
        let mut cells: Map<String, Value> = serde_json::from_str(&data).unwrap_or_default();
        if number_of(cells.get(&key)).is_some() {
            continue;
        }
        last += 1;
        cells.insert(key.clone(), Value::String(last.to_string()));
        conn.execute(
            "UPDATE sheet_rows SET data = ?2 WHERE row_id = ?1",
            params![row_id, serde_json::to_string(&cells).unwrap_or_else(|_| data.clone())],
        )?;
    }
    remember(conn, sheet_id, last)
}

/// Every table, at start: one that gained the column since the app last ran has its rows numbered.
pub fn fill_all(conn: &mut Connection) -> rusqlite::Result<()> {
    let ids: Vec<i64> = conn
        .prepare("SELECT sheet_id FROM sheets")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let tx = conn.transaction()?;
    for sheet_id in ids {
        fill_missing(&tx, sheet_id)?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory() -> Connection {
        let path = std::env::temp_dir().join(format!("ukmac-ids-{}.db", uuid::Uuid::new_v4()));
        crate::db::open(&path).unwrap()
    }

    /// A table with an ID column (c1) and a Name (c2), and these names in rows already.
    fn table(conn: &Connection, names: &[&str]) -> i64 {
        conn.execute("INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'Farm', 'F-1')", []).unwrap();
        let mut id = Column::new("ID", "number");
        id.key = "c1".into();
        id.auto = true;
        let mut name = Column::new("Name", "text");
        name.key = "c2".into();
        conn.execute(
            "INSERT INTO sheets (mac_id, title, columns, next_key) VALUES (1, 'Batch', ?1, 3)",
            [serde_json::to_string(&vec![id, name]).unwrap()],
        )
        .unwrap();
        let sheet_id = conn.last_insert_rowid();
        for (index, name) in names.iter().enumerate() {
            conn.execute(
                "INSERT INTO sheet_rows (sheet_id, position, data) VALUES (?1, ?2, ?3)",
                params![sheet_id, index as f64 + 1.0, json!({ "c2": name }).to_string()],
            )
            .unwrap();
        }
        sheet_id
    }

    fn ids(conn: &Connection, sheet_id: i64) -> Vec<(String, String)> {
        let mut statement = conn.prepare("SELECT data FROM sheet_rows WHERE sheet_id = ?1 ORDER BY position").unwrap();
        statement
            .query_map([sheet_id], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|data| {
                let cells: Map<String, Value> = serde_json::from_str(&data.unwrap()).unwrap();
                let text = |key: &str| cells.get(key).and_then(Value::as_str).unwrap_or("").to_string();
                (text("c1"), text("c2"))
            })
            .collect()
    }

    fn row(name: &str) -> Map<String, Value> {
        json!({ "c2": name }).as_object().unwrap().clone()
    }

    #[test]
    fn rows_that_have_none_are_numbered_in_the_order_they_are_shown() {
        let conn = memory();
        let sheet = table(&conn, &["B1", "B2", "B3"]);
        fill_missing(&conn, sheet).unwrap();
        assert_eq!(ids(&conn, sheet), [("1".into(), "B1".into()), ("2".into(), "B2".into()), ("3".into(), "B3".into())]);
        // Again: nothing changes.
        fill_missing(&conn, sheet).unwrap();
        assert_eq!(ids(&conn, sheet).iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), ["1", "2", "3"]);
    }

    #[test]
    fn a_new_row_gets_the_next_number_and_a_number_is_never_used_twice() {
        let conn = memory();
        let sheet = table(&conn, &["B1", "B2"]);
        fill_missing(&conn, sheet).unwrap();
        let mut rows = vec![row("B3"), row("B4")];
        assign(&conn, sheet, &mut rows).unwrap();
        assert_eq!(rows[0]["c1"], "3");
        assert_eq!(rows[1]["c1"], "4");
        // The last row goes: its number is not given again.
        conn.execute("INSERT INTO sheet_rows (sheet_id, position, data) VALUES (?1, 9, ?2)", params![sheet, json!({ "c1": "4", "c2": "B4" }).to_string()]).unwrap();
        let row_id = conn.last_insert_rowid();
        conn.execute("DELETE FROM sheet_rows WHERE row_id = ?1", [row_id]).unwrap();
        let mut more = vec![row("B5")];
        assign(&conn, sheet, &mut more).unwrap();
        assert_eq!(more[0]["c1"], "5");
    }

    #[test]
    fn a_row_that_comes_with_its_number_keeps_it_and_the_next_goes_past_it() {
        let conn = memory();
        let sheet = table(&conn, &[]);
        let mut rows = vec![json!({ "c1": "40", "c2": "B40" }).as_object().unwrap().clone(), row("B41")];
        assign(&conn, sheet, &mut rows).unwrap();
        assert_eq!((rows[0]["c1"].as_str(), rows[1]["c1"].as_str()), (Some("40"), Some("41")));
    }

    #[test]
    fn a_table_with_no_auto_column_is_left_alone() {
        let conn = memory();
        let sheet = table(&conn, &["B1"]);
        conn.execute("UPDATE sheets SET columns = '[{\"key\":\"c2\",\"name\":\"Name\",\"type\":\"text\"}]' WHERE sheet_id = ?1", [sheet]).unwrap();
        assert_eq!(auto_key(&conn, sheet).unwrap(), None);
        let mut rows = vec![row("B2")];
        assign(&conn, sheet, &mut rows).unwrap();
        assert!(!rows[0].contains_key("c1"));
        fill_missing(&conn, sheet).unwrap();
        assert_eq!(ids(&conn, sheet), [("".into(), "B1".into())]);
    }

    #[test]
    fn every_table_is_numbered_at_start() {
        let mut conn = memory();
        let sheet = table(&conn, &["B1", "B2"]);
        fill_all(&mut conn).unwrap();
        assert_eq!(ids(&conn, sheet).len(), 2);
        assert!(ids(&conn, sheet).iter().all(|(id, _)| !id.is_empty()));
    }
}
