//! Table rows in the database: read, insert and order them.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params, Transaction};
use serde_json::{Map, Value};

use crate::error::{CmdResult, err};
use crate::models::Row;

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

pub(crate) fn load_rows_by_id(conn: &Connection, ids: &[i64]) -> CmdResult<Vec<Row>> {
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
    mut rows: Vec<Map<String, Value>>,
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
    // A table with an ID column numbers its new rows (db/ids.rs).
    crate::db::ids::assign(tx, sheet_id, &mut rows).map_err(err)?;
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

/// The rows in this order (sorted or moved in the sheet): the ones named
/// first, one after another; any not named keep their order after them.
pub(crate) fn set_row_order(tx: &Transaction, sheet_id: i64, row_ids: &[i64]) -> CmdResult<()> {
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
