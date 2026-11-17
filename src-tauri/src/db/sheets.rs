//! Tables in the database: read them, give their columns keys, insert them, and keep formulas pointing at renamed tables.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params, Transaction};

use crate::db::macs::clean;
use crate::error::{CmdResult, err};
use crate::models::{Column, Sheet};

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

pub(crate) fn load_sheet(conn: &Connection, sheet_id: i64) -> CmdResult<Sheet> {
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

/// Gives every column without a key the next one (`c<n>`), and checks
/// names and types. Returns the next key number.
pub(crate) fn assign_keys(columns: &mut [Column], mut next_key: i64) -> CmdResult<i64> {
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
pub(crate) fn insert_sheet(
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

/// A table's name in a formula or link: `'Name'[`, and `Name[` for a
/// one-word name.
pub(crate) fn table_refs(title: &str) -> Vec<String> {
    let mut refs = vec![format!("'{}'[", title.replace('\'', "''"))];
    if title.chars().all(|c| c.is_alphanumeric() || c == '_') {
        refs.push(format!("{title}["));
    }
    refs
}

pub(crate) fn rewrite_columns(columns: &mut [Column], rewrite: &dyn Fn(&str) -> String) -> bool {
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

pub(crate) fn store_columns(conn: &Connection, sheet_id: i64, columns: &[Column]) -> CmdResult<()> {
    conn.execute(
        "UPDATE sheets SET columns = ?2, updated_at = datetime('now') WHERE sheet_id = ?1",
        params![sheet_id, serde_json::to_string(columns).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

/// Replaces `old` with `new` where it isn't the tail of a longer name
/// (`Zones[` in `MyZones[` stays).
pub(crate) fn replace_ref(text: &str, old: &str, new: &str) -> String {
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
