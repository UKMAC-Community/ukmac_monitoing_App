//! Tables made by an earlier version, brought up to what the template gives them now: once, the first time the app opens
//! after an update, on every computer, so nobody has to press anything (and nothing of theirs is lost).
//!
//! For each table a step names (by the template it was made from), each column of the template:
//!
//! - one the table has (same stage box, group and name) takes the template's other names, so a Google tab's header it
//!   answers to now fills it;
//! - one the table hasn't, but has a column of its own for under the sheet's name (`zone_plot`, `Plants Eligible for
//!   Pruning`: what Sync or an import added when the template had no column for that header), *is* that column: it is
//!   renamed and typed as the template's, keeping its key, so its values and the Google link's match stay with it;
//!   one the template's column already is, but empty, takes that column's values and the column goes;
//! - one the table has nothing for is added, empty, after the template's column before it.
//!
//! A Google link's remembered headers follow: a header that went to a column which no longer answers to it (Fertilizer's
//! `applied` went to Date; it is Applied's now) goes to the one that does, with what it had filled; a header left out when
//! the table had no column for it goes to the column just added for it. A header the person left out while a column for it
//! was there stays left out. A linked table that changed is read again from Google at the next check (`RESYNC_KEY`), so
//! its cells are written as the new columns want them.
//!
//! The steps taken are kept in `settings` (`STEP_KEY`): each runs once, so a column the person deletes afterwards stays deleted.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value};

use crate::models::Column;
use crate::services::template;

/// How many of `STEPS` this database has taken.
pub const STEP_KEY: &str = "template.step";
/// The linked tables (a JSON list of sheet ids) to read again from Google, as soon as the app can.
pub const RESYNC_KEY: &str = "google.resync";

/// Each step: the template tables whose columns it changed. Add a step (never edit one already shipped) when a release
/// changes a template table's columns.
const STEPS: &[&[&str]] = &[
    // 1 (the update after 0.1.13): Fertigation, Pruning and Pesticides read the farm sheet's Fertilizer, Pruning and Fungicide
    // tabs column by column (0.1.13 gave them Date, Zone and Note only); Fertilizer's `applied` (TRUE/FALSE) is Fertigation's
    // Applied, not its Date; Pruning's Plants answers to "Plants Eligible for Pruning", as the tab names it now.
    &["fertigation", "pruning", "pesticides"],
    // 2: Plant Progress has the farm sheet's two-line header: Plant count under "Total chili plants planted", the replant date and
    // count under "Replanting plants", Dead plant under "Plant dead after planting". The columns keep their keys and values
    // (a column of the table that the template now has in a group is that column).
    &["zone-records"],
];

pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    let taken: usize = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [STEP_KEY], |row| row.get::<_, String>(0))
        .optional()?
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0);
    if taken >= STEPS.len() {
        return Ok(());
    }
    let keys: HashSet<&str> = STEPS[taken..].iter().flat_map(|step| step.iter().copied()).collect();
    let tx = conn.transaction()?;
    let sheets: Vec<(i64, String)> = {
        let mut statement = tx.prepare("SELECT sheet_id, template_key FROM sheets WHERE template_key IS NOT NULL ORDER BY sheet_id")?;
        let found = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        found
    };
    let mut resync = Vec::new();
    for (sheet_id, key) in sheets {
        if keys.contains(key.as_str()) && upgrade_table(&tx, sheet_id, &key)? {
            resync.push(sheet_id);
        }
    }
    if !resync.is_empty() {
        let mut ids: Vec<i64> = tx
            .query_row("SELECT value FROM settings WHERE key = ?1", [RESYNC_KEY], |row| row.get::<_, String>(0))
            .optional()?
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        for id in resync {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        set(&tx, RESYNC_KEY, &serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into()))?;
    }
    set(&tx, STEP_KEY, &STEPS.len().to_string())?;
    tx.commit()
}

fn set(tx: &Transaction, key: &str, value: &str) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// A name as a Google tab's header is matched (the app's `normalizeHeader`): spacing and case aside, a trailing `*` dropped.
pub(crate) fn normalize(value: &str) -> String {
    let mut text = value.trim_start_matches('\u{feff}').to_string();
    for mark in ['›', '·'] {
        text = text.split(mark).map(str::trim).collect::<Vec<_>>().join(&format!(" {mark} "));
    }
    let text = text.trim();
    let text = text.trim_end_matches('*').trim_end();
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// A column told apart by its stage box, group and name, spacing and case aside (the app's `columnIdentity`).
fn same_column(a: &Column, b: &Column) -> bool {
    let clean = |text: Option<&str>| text.unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    clean(a.box_name.as_deref()) == clean(b.box_name.as_deref())
        && clean(a.group.as_deref()) == clean(b.group.as_deref())
        && clean(Some(&a.name)) == clean(Some(&b.name))
}

/// Every name a column answers to, as headers are matched.
fn names_of(column: &Column) -> HashSet<String> {
    std::iter::once(&column.name).chain(column.aliases.iter()).map(|name| normalize(name)).collect()
}

fn has_value(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::String(text)) => !text.trim().is_empty(),
        Some(_) => true,
    }
}

/// A cell moved to a yes/no column, written as one ("Yes", "TRUE" → "true"); anything else is moved as it is.
fn as_cell_of(column: &Column, value: Value) -> Value {
    if column.col_type != "yesno" {
        return value;
    }
    let text = match &value {
        Value::String(text) => text.trim().to_lowercase(),
        Value::Bool(yes) => yes.to_string(),
        other => other.to_string(),
    };
    match text.as_str() {
        "yes" | "y" | "true" | "1" | "ok" | "✓" => Value::String("true".into()),
        "no" | "n" | "false" | "0" => Value::String("false".into()),
        _ => value,
    }
}

/// Moves each row's value from one column to another that has none (the first column's cell goes either way).
fn move_values(rows: &mut [(i64, Map<String, Value>, bool)], from: &str, to: &Column) {
    for (_, data, changed) in rows.iter_mut() {
        let Some(value) = data.remove(from) else { continue };
        *changed = true;
        if has_value(Some(&value)) && !has_value(data.get(&to.key)) {
            data.insert(to.key.clone(), as_cell_of(to, value));
        }
    }
}

/// Every text in `value` that is exactly the key `from` (a column a card or chart reads) becomes `to`. True when one was.
fn rename_key(value: &mut Value, from: &str, to: &str) -> bool {
    match value {
        Value::String(text) if text == from => {
            *text = to.to_string();
            true
        }
        Value::Array(items) => items.iter_mut().fold(false, |found, item| rename_key(item, from, to) || found),
        Value::Object(map) => map.values_mut().fold(false, |found, item| rename_key(item, from, to) || found),
        _ => false,
    }
}

/// Brings one table up to its template. True when it is read from Google and changed (so it should be read again).
fn upgrade_table(tx: &Transaction, sheet_id: i64, template_key: &str) -> rusqlite::Result<bool> {
    let Some(template) = template::chili_template().into_iter().find(|sheet| sheet.key == template_key).map(|sheet| sheet.columns) else {
        return Ok(false);
    };
    let (text, next_key, dashboard): (String, i64, Option<String>) = tx.query_row(
        "SELECT columns, next_key, dashboard FROM sheets WHERE sheet_id = ?1",
        [sheet_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    // The table's own dashboard names columns by key: one folded into another is named by the other's after.
    let mut dashboard: Option<Value> = dashboard.and_then(|text| serde_json::from_str(&text).ok());
    let mut dashboard_changed = false;
    // A table whose columns can't be read is left as it is.
    let Ok(mut columns) = serde_json::from_str::<Vec<Column>>(&text) else {
        return Ok(false);
    };
    let link: Option<(String, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT header_map, last_synced_at, origin FROM google_links WHERE sheet_id = ?1",
            [sheet_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    // A link the app writes to (a sheet made from the table) is never read: its headers are the table's own.
    let read_from_google = link.as_ref().is_some_and(|(_, _, origin)| origin.as_deref() != Some("app"));
    let mut header_map: Map<String, Value> = link
        .as_ref()
        .filter(|_| read_from_google)
        .and_then(|(map, _, _)| serde_json::from_str(map).ok())
        .unwrap_or_default();
    let mut rows: Vec<(i64, Map<String, Value>, bool)> = {
        let mut statement = tx.prepare("SELECT row_id, data FROM sheet_rows WHERE sheet_id = ?1")?;
        let found = statement
            .query_map([sheet_id], |row| {
                let data: String = row.get(1)?;
                Ok((row.get(0)?, serde_json::from_str(&data).unwrap_or_default(), false))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        found
    };

    let mut next = next_key.max(
        columns.iter().filter_map(|column| column.key.strip_prefix('c')?.parse::<i64>().ok()).max().unwrap_or(0) + 1,
    );
    let mut changed = false;
    let mut map_changed = false;
    // The template's columns this update gave the table (added, or one of its own made the template's).
    let mut given: HashSet<String> = HashSet::new();
    let is_template = |column: &Column| template.iter().any(|item| same_column(column, item));
    let filled = |rows: &[(i64, Map<String, Value>, bool)], key: &str| rows.iter().any(|(_, data, _)| has_value(data.get(key)));
    let mut last: Option<String> = columns.iter().find(|column| column.auto).map(|column| column.key.clone());

    for item in template.iter().filter(|column| !column.auto) {
        let wanted = names_of(item);
        // The table's own columns (not the template's) for a header this one answers to: by their name, or by the header the link filled them from.
        let strays: Vec<String> = columns
            .iter()
            .filter(|column| !column.auto && column.col_type != "formula" && !is_template(column))
            .filter(|column| {
                wanted.contains(&normalize(&column.name))
                    || header_map.iter().any(|(header, key)| key.as_str() == Some(column.key.as_str()) && wanted.contains(&normalize(header)))
            })
            .map(|column| column.key.clone())
            .collect();
        let key = match columns.iter().position(|column| same_column(column, item)) {
            Some(at) => {
                if columns[at].aliases != item.aliases {
                    columns[at].aliases = item.aliases.clone();
                    changed = true;
                }
                // Its type, as the template has it (Sync made Applicable text, its TRUE / FALSE now a yes / no).
                if columns[at].col_type != item.col_type {
                    columns[at].col_type = item.col_type.clone();
                    columns[at].source = item.source.clone();
                    columns[at].options = item.options.clone();
                    let key = columns[at].key.clone();
                    for (_, data, changed_row) in rows.iter_mut() {
                        if let Some(value) = data.get(&key).cloned() {
                            let written = as_cell_of(item, value.clone());
                            if written != value {
                                data.insert(key.clone(), written);
                                *changed_row = true;
                            }
                        }
                    }
                    changed = true;
                }
                let target = columns[at].clone();
                for stray in &strays {
                    // Only into a column that holds nothing: two sets of values are left for the person to look at.
                    if filled(&rows, &target.key) {
                        break;
                    }
                    move_values(&mut rows, stray, &target);
                    columns.retain(|column| column.key != *stray);
                    if let Some(dashboard) = dashboard.as_mut() {
                        dashboard_changed |= rename_key(dashboard, stray, &target.key);
                    }
                    for value in header_map.values_mut() {
                        if value.as_str() == Some(stray.as_str()) {
                            *value = Value::String(target.key.clone());
                        }
                    }
                    changed = true;
                    map_changed = true;
                }
                target.key
            }
            None => {
                if let Some(stray) = strays.first() {
                    // That column is this one: the template's name, type and other names; its key, values and width kept.
                    let column = columns.iter_mut().find(|column| column.key == *stray).unwrap();
                    *column = Column { key: stray.clone(), width: column.width, ..item.clone() };
                    for (_, data, changed_row) in rows.iter_mut() {
                        if let Some(value) = data.get(stray).cloned() {
                            let written = as_cell_of(item, value.clone());
                            if written != value {
                                data.insert(stray.clone(), written);
                                *changed_row = true;
                            }
                        }
                    }
                    changed = true;
                    given.insert(stray.clone());
                    stray.clone()
                } else {
                    let key = format!("c{next}");
                    next += 1;
                    let at = last
                        .as_ref()
                        .and_then(|last| columns.iter().position(|column| column.key == *last))
                        .map_or(0, |at| at + 1);
                    columns.insert(at, Column { key: key.clone(), ..item.clone() });
                    changed = true;
                    given.insert(key.clone());
                    key
                }
            }
        };
        // New columns go after the furthest of the template's the table has so far (a 0.1.13 table has its Date first).
        let at = |key: &str| columns.iter().position(|column| column.key == key);
        if last.as_deref().and_then(at).is_none_or(|furthest| at(&key).is_some_and(|here| here > furthest)) {
            last = Some(key);
        }
    }

    // The link's remembered headers, to the columns that answer to them now.
    if read_from_google {
        let answering = |header: &str| -> Option<Column> {
            let name = normalize(header);
            let found: Vec<&Column> = columns.iter().filter(|column| is_template(column) && names_of(column).contains(&name)).collect();
            (found.len() == 1).then(|| found[0].clone())
        };
        let headers: Vec<String> = header_map.keys().cloned().collect();
        for header in headers {
            let Some(target) = answering(&header) else { continue };
            let current = header_map.get(&header).and_then(Value::as_str).unwrap_or("").to_string();
            if current == target.key {
                continue;
            }
            // Another header fills that column already: it stays so.
            if header_map.iter().any(|(other, key)| *other != header && key.as_str() == Some(target.key.as_str())) {
                continue;
            }
            let moves = if current.is_empty() {
                // Left out: on purpose while a column for it was there; for want of one if this update just gave it.
                given.contains(&target.key)
            } else {
                match columns.iter().find(|column| column.key == current) {
                    None => true,
                    // It went to a column of the template's that doesn't answer to it (any more).
                    Some(column) => is_template(column) && !names_of(column).contains(&normalize(&header)),
                }
            };
            if !moves {
                continue;
            }
            // What it filled goes with it, when that column was filled from this header alone and the new one is empty.
            let only_this = !header_map.iter().any(|(other, key)| *other != header && key.as_str() == Some(current.as_str()));
            if !current.is_empty() && only_this && !filled(&rows, &target.key) && columns.iter().any(|column| column.key == current) {
                move_values(&mut rows, &current, &target);
            }
            header_map.insert(header, Value::String(target.key.clone()));
            map_changed = true;
        }
    }

    if !changed && !map_changed && !rows.iter().any(|(_, _, changed)| *changed) {
        return Ok(false);
    }
    tx.execute(
        "UPDATE sheets SET columns = ?2, next_key = ?3, updated_at = datetime('now') WHERE sheet_id = ?1",
        params![sheet_id, serde_json::to_string(&columns).unwrap_or(text), next],
    )?;
    for (row_id, data, changed_row) in &rows {
        if *changed_row {
            tx.execute(
                "UPDATE sheet_rows SET data = ?2 WHERE row_id = ?1",
                params![row_id, serde_json::to_string(data).unwrap_or_else(|_| "{}".into())],
            )?;
        }
    }
    if let (true, Some(dashboard)) = (dashboard_changed, dashboard.as_ref()) {
        tx.execute("UPDATE sheets SET dashboard = ?2 WHERE sheet_id = ?1", params![sheet_id, dashboard.to_string()])?;
    }
    if map_changed {
        tx.execute(
            "UPDATE google_links SET header_map = ?2 WHERE sheet_id = ?1",
            params![sheet_id, serde_json::to_string(&header_map).unwrap_or_else(|_| "{}".into())],
        )?;
    }
    // Read again from Google once it can be: only a table read before (one never read waits for its first Sync).
    Ok(read_from_google && link.is_some_and(|(_, synced, _)| synced.is_some()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn columns_of(conn: &Connection, sheet_id: i64) -> Vec<Column> {
        let text: String = conn.query_row("SELECT columns FROM sheets WHERE sheet_id = ?1", [sheet_id], |row| row.get(0)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn names(conn: &Connection, sheet_id: i64) -> Vec<String> {
        columns_of(conn, sheet_id).into_iter().map(|column| column.name).collect()
    }

    fn key_of(conn: &Connection, sheet_id: i64, name: &str) -> String {
        columns_of(conn, sheet_id).into_iter().find(|column| column.name == name).unwrap().key
    }

    fn header_map(conn: &Connection, sheet_id: i64) -> Map<String, Value> {
        let text: String = conn.query_row("SELECT header_map FROM google_links WHERE sheet_id = ?1", [sheet_id], |row| row.get(0)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn cells(conn: &Connection, sheet_id: i64) -> Vec<Map<String, Value>> {
        let mut statement = conn.prepare("SELECT data FROM sheet_rows WHERE sheet_id = ?1 ORDER BY position").unwrap();
        statement
            .query_map([sheet_id], |row| Ok(serde_json::from_str::<Map<String, Value>>(&row.get::<_, String>(0)?).unwrap()))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn setting(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0)).optional().unwrap()
    }

    /// A column as 0.1.13 kept it (as JSON, the way the database has it).
    fn column(key: &str, name: &str, col_type: &str) -> Value {
        serde_json::json!({ "key": key, "name": name, "type": col_type })
    }

    fn add_table(conn: &Connection, sheet_id: i64, title: &str, key: &str, columns: Value, next_key: i64) {
        conn.execute(
            "INSERT INTO sheets (sheet_id, mac_id, title, template_key, columns, next_key) VALUES (?1, 1, ?2, ?3, ?4, ?5)",
            params![sheet_id, title, key, columns.to_string(), next_key],
        )
        .unwrap();
    }

    fn add_rows(conn: &Connection, sheet_id: i64, rows: &[Value]) {
        for (index, row) in rows.iter().enumerate() {
            conn.execute("INSERT INTO sheet_rows (sheet_id, position, data) VALUES (?1, ?2, ?3)", params![sheet_id, index as f64, row.to_string()])
                .unwrap();
        }
    }

    fn add_link(conn: &Connection, sheet_id: i64, tab: &str, header_map: Value) {
        conn.execute(
            "INSERT INTO google_links (sheet_id, spreadsheet_id, spreadsheet_title, tab_title, header_map, last_synced_at, last_row_count)
             VALUES (?1, 'farm-sheet', 'Farm', ?2, ?3, '2026-11-12 08:00:00', 2)",
            params![sheet_id, tab, header_map.to_string()],
        )
        .unwrap();
    }

    /// A database as 0.1.13 left it: Fertigation, Pruning and Pesticides made as Date, Zone, Note; Pruning linked to the farm's
    /// Pruning tab (its headers in words), Sync having added a column for each header the table had none for; Pesticides linked
    /// to the Fungicide tab, its `zone_plot` matched to Zone by hand and the rest left out; Fertigation never linked or filled.
    fn as_0_1_13_left_it() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate_for_tests(&mut conn);
        conn.execute("INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'Pursat', 'MAC-001')", []).unwrap();
        let log = |extra: &[Value]| {
            let mut list = vec![column("c4", "ID", "number"), column("c1", "Date", "date"), column("c2", "Zone", "link"), column("c3", "Note", "text")];
            list[0]["auto"] = Value::Bool(true);
            list[2]["source"] = Value::String("'Zones'[Plot]".into());
            list.extend(extra.iter().cloned());
            Value::Array(list)
        };
        add_table(&conn, 7, "Fertigation", "fertigation", log(&[]), 5);
        add_table(
            &conn,
            8,
            "Pruning",
            "pruning",
            log(&[
                column("c5", "Zone Plot", "text"),
                column("c6", "Pruning Round", "number"),
                column("c7", "Round Name", "text"),
                column("c8", "Plants Eligible for Pruning", "number"),
                column("c9", "Applicable", "text"),
                column("c10", "Planned Date", "date"),
                column("c11", "Actual Date", "date"),
            ]),
            12,
        );
        add_rows(
            &conn,
            8,
            &[
                serde_json::json!({ "c4": "1", "c5": "A1", "c6": "1", "c7": "1st Pruning", "c8": "1555", "c9": "TRUE", "c10": "2026-07-08", "c11": "2026-07-08" }),
                serde_json::json!({ "c4": "2", "c5": "A5", "c6": "3", "c7": "3rd Pruning", "c8": "0", "c9": "FALSE" }),
            ],
        );
        add_link(
            &conn,
            8,
            "Pruning",
            serde_json::json!({
                "zone plot": "c5", "pruning round": "c6", "round name": "c7", "plants eligible for pruning": "c8",
                "applicable": "c9", "planned date": "c10", "actual date": "c11"
            }),
        );
        add_table(&conn, 9, "Pesticides", "pesticides", log(&[]), 5);
        add_rows(&conn, 9, &[serde_json::json!({ "c4": "1", "c2": "A1" })]);
        add_link(
            &conn,
            9,
            "Fungicide",
            serde_json::json!({
                "zone_plot": "c2", "application_round": "", "target_fungi": "", "date_applied": "", "active_ingredients": "", "dosage": ""
            }),
        );
        conn
    }

    #[test]
    fn plant_progress_gets_the_farm_sheet_s_header_groups_and_keeps_its_columns_and_values() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate_for_tests(&mut conn);
        conn.execute("INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'Pursat', 'MAC-001')", []).unwrap();
        let mut list = vec![
            column("c13", "ID", "number"),
            column("c1", "Zone plot", "link"),
            column("c2", "Record date", "date"),
            column("c4", "Plant count", "number"),
            column("c8", "Replant date", "date"),
            column("c9", "Replant count", "number"),
            column("c10", "Dead plant", "number"),
            column("c7", "Status", "text"),
        ];
        list[0]["auto"] = Value::Bool(true);
        list[1]["source"] = Value::String("'Zones'[Plot]".into());
        add_table(&conn, 4, "Plant Progress", "zone-records", Value::Array(list), 14);
        add_rows(&conn, 4, &[serde_json::json!({ "c13": "1", "c1": "A1", "c2": "2026-06-08", "c4": "1615", "c8": "2026-06-19", "c9": "53", "c10": "73", "c7": "Cycle complete" })]);
        add_link(
            &conn,
            4,
            "Plant Progress",
            serde_json::json!({ "planting date": "c2", "total chili plants planted › number": "c4", "replanting plants › date": "c8", "replanting plants › plant no": "c9" }),
        );
        let before = header_map(&conn, 4);

        run(&mut conn).unwrap();

        let columns = columns_of(&conn, 4);
        let group_of = |name: &str| columns.iter().find(|column| column.name == name).unwrap().group.clone();
        assert_eq!(group_of("Plant count").as_deref(), Some("Total chili plants planted"));
        assert_eq!(group_of("Replant date").as_deref(), Some("Replanting plants"));
        assert_eq!(group_of("Replant count").as_deref(), Some("Replanting plants"));
        assert_eq!(group_of("Dead plant").as_deref(), Some("Plant dead after planting"));
        assert_eq!(group_of("Status"), None);
        // The same columns: keys, values and the Google link's headers are as they were, and nothing was added.
        assert_eq!(key_of(&conn, 4, "Plant count"), "c4");
        assert_eq!(key_of(&conn, 4, "Replant count"), "c9");
        assert_eq!(cells(&conn, 4)[0].get("c9").and_then(Value::as_str), Some("53"));
        assert_eq!(header_map(&conn, 4), before);
        assert!(columns.iter().filter(|column| column.name == "Plant count").count() == 1);
    }

    #[test]
    fn a_pruning_table_synced_by_0_1_13_keeps_its_values_under_the_template_s_columns() {
        let mut conn = as_0_1_13_left_it();
        run(&mut conn).unwrap();

        // The columns Sync added under the tab's names are the template's now, where they were; what the table lacked is added.
        assert_eq!(
            names(&conn, 8),
            ["ID", "Plan", "Date", "Zone", "Note", "Round", "Round Name", "Plants", "Applicable", "Planned Date"]
        );
        let columns = columns_of(&conn, 8);
        let of = |name: &str| columns.iter().find(|column| column.name == name).unwrap().clone();
        assert_eq!((of("Round").key.as_str(), of("Plants").key.as_str(), of("Applicable").col_type.as_str()), ("c6", "c8", "yesno"));
        // Its Zone Plot and Actual Date went into the Zone and Date it already had (they held nothing).
        let rows = cells(&conn, 8);
        assert_eq!(rows[0]["c2"], "A1");
        assert_eq!(rows[0]["c1"], "2026-07-08");
        assert!(!rows[0].contains_key("c5") && !rows[0].contains_key("c11"));
        // TRUE / FALSE under Applicable, written as a yes/no.
        assert_eq!((rows[0]["c9"].as_str(), rows[1]["c9"].as_str()), (Some("true"), Some("false")));
        assert_eq!(rows[0]["c8"], "1555");

        // The link fills the same columns from the same headers.
        let map = header_map(&conn, 8);
        assert_eq!(map["zone plot"], "c2");
        assert_eq!(map["actual date"], "c1");
        assert_eq!(map["plants eligible for pruning"], "c8");
        assert_eq!(map["planned date"], "c10");
        // …and it is read again from Google, so every cell is written as its column now wants it.
        assert_eq!(setting(&conn, RESYNC_KEY).as_deref(), Some("[8,9]"));
    }

    #[test]
    fn headers_left_out_for_want_of_a_column_fill_the_columns_the_update_adds() {
        let mut conn = as_0_1_13_left_it();
        run(&mut conn).unwrap();

        assert_eq!(names(&conn, 9), ["ID", "Date", "Zone", "Application", "Disease", "Chemical", "Dose", "Note"]);
        let map = header_map(&conn, 9);
        for (header, column) in [("application_round", "Application"), ("target_fungi", "Disease"), ("active_ingredients", "Chemical"), ("dosage", "Dose")] {
            assert_eq!(map[header].as_str(), Some(key_of(&conn, 9, column).as_str()), "{header}");
        }
        // Date was there all along: a header left out while it was there stays left out.
        assert_eq!(map["date_applied"], "");
        assert_eq!(map["zone_plot"], "c2");
    }

    #[test]
    fn a_table_never_linked_gets_the_template_s_columns_and_is_not_read() {
        let mut conn = as_0_1_13_left_it();
        run(&mut conn).unwrap();

        assert_eq!(names(&conn, 7), ["ID", "Date", "Zone", "Application", "Applied", "Fertilizer", "Quantity", "Note"]);
        let applied = columns_of(&conn, 7).into_iter().find(|column| column.name == "Applied").unwrap();
        assert_eq!(applied.col_type, "yesno");
        // New keys after the ones it had, never one handed out before.
        let keys: Vec<String> = columns_of(&conn, 7).into_iter().map(|column| column.key).collect();
        assert_eq!(keys, ["c4", "c1", "c2", "c5", "c6", "c7", "c8", "c3"]);
        let next: i64 = conn.query_row("SELECT next_key FROM sheets WHERE sheet_id = 7", [], |row| row.get(0)).unwrap();
        assert_eq!(next, 9);
    }

    #[test]
    fn it_runs_once() {
        let mut conn = as_0_1_13_left_it();
        run(&mut conn).unwrap();
        assert_eq!(setting(&conn, STEP_KEY).as_deref(), Some(&*STEPS.len().to_string()));
        // A column the person takes off afterwards stays off.
        let mut columns = columns_of(&conn, 7);
        columns.retain(|column| column.name != "Quantity");
        conn.execute("UPDATE sheets SET columns = ?1 WHERE sheet_id = 7", [serde_json::to_string(&columns).unwrap()]).unwrap();
        let before: Vec<String> = (7..=9).flat_map(|id| names(&conn, id)).collect();
        run(&mut conn).unwrap();
        let after: Vec<String> = (7..=9).flat_map(|id| names(&conn, id)).collect();
        assert_eq!(before, after);
        assert!(!names(&conn, 7).contains(&"Quantity".to_string()));
    }

    /// The Mac this was made on: its tables already had the template's columns (put there by hand), but the Pruning tab's
    /// "Plants Eligible for Pruning" had become a column of its own beside the empty Plants, and Fertilizer's `applied`
    /// (TRUE/FALSE) went into Fertigation's Date.
    #[test]
    fn a_table_already_up_to_date_has_its_strays_folded_in_and_its_link_put_right() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate_for_tests(&mut conn);
        conn.execute("INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'Pursat', 'MAC-001')", []).unwrap();
        let template = |key: &str, keys: &[&str]| {
            let columns = template::chili_template().into_iter().find(|sheet| sheet.key == key).unwrap().columns;
            let mut list: Vec<Value> = columns
                .into_iter()
                .filter(|column| column.name != "Applied" && column.name != "Plants Eligible for Pruning")
                .map(|mut column| {
                    // As the table was made: before the new other names.
                    column.aliases.retain(|alias| !alias.to_lowercase().contains("eligible"));
                    if column.name == "Date" {
                        column.aliases.push("Applied".into());
                    }
                    serde_json::to_value(column).unwrap()
                })
                .collect();
            for (item, key) in list.iter_mut().zip(keys) {
                item["key"] = Value::String(key.to_string());
            }
            Value::Array(list)
        };
        add_table(&conn, 7, "Fertigation", "fertigation", template("fertigation", &["c4", "c1", "c2", "c5", "c6", "c7"]), 8);
        add_rows(&conn, 7, &[serde_json::json!({ "c4": "1", "c1": "Yes", "c2": "A1", "c5": "1" }), serde_json::json!({ "c4": "2", "c1": "No", "c2": "A1", "c5": "2" })]);
        add_link(&conn, 7, "Fertilizer", serde_json::json!({ "zone_plot": "c2", "application_round": "c5", "applied": "c1", "fertilizer_type": "c6", "quantity": "c7" }));
        let mut pruning = template("pruning", &["c4", "c5", "c2", "c6", "c7", "c8", "c9", "c10", "c11"]);
        pruning.as_array_mut().unwrap().push(column("c12", "Plants Eligible for Pruning", "number"));
        add_table(&conn, 8, "Pruning", "pruning", pruning, 13);
        add_rows(&conn, 8, &[serde_json::json!({ "c4": "1", "c2": "A1", "c12": "1555", "c9": "true" })]);
        add_link(&conn, 8, "Pruning", serde_json::json!({ "zone plot": "c2", "plants eligible for pruning": "c12", "applicable": "c9" }));

        run(&mut conn).unwrap();

        // Pruning: the stray's values in Plants, the stray gone, the header to Plants.
        assert!(!names(&conn, 8).contains(&"Plants Eligible for Pruning".to_string()));
        assert_eq!(cells(&conn, 8)[0]["c8"], "1555");
        assert_eq!(header_map(&conn, 8)["plants eligible for pruning"], "c8");
        // Fertigation: `applied` fills Applied, with the yes / no it had put in Date; Date answers to it no more.
        let applied = key_of(&conn, 7, "Applied");
        assert_eq!(header_map(&conn, 7)["applied"].as_str(), Some(applied.as_str()));
        let rows = cells(&conn, 7);
        assert_eq!((rows[0][&applied].as_str(), rows[1][&applied].as_str()), (Some("true"), Some("false")));
        assert!(!rows[0].contains_key("c1"));
        let date = columns_of(&conn, 7).into_iter().find(|column| column.name == "Date").unwrap();
        assert!(!date.aliases.iter().any(|alias| alias == "Applied"));
    }

    #[test]
    fn a_dashboard_reading_a_folded_column_reads_the_column_it_went_into() {
        let mut conn = as_0_1_13_left_it();
        conn.execute(
            "UPDATE sheets SET dashboard = ?1 WHERE sheet_id = 8",
            [serde_json::json!({ "kpis": [{ "column": "c11", "label": "Last pruning" }], "summaries": [{ "groupBy": "c5" }] }).to_string()],
        )
        .unwrap();
        run(&mut conn).unwrap();
        let text: String = conn.query_row("SELECT dashboard FROM sheets WHERE sheet_id = 8", [], |row| row.get(0)).unwrap();
        let dashboard: Value = serde_json::from_str(&text).unwrap();
        // Actual Date (c11) went into Date (c1), Zone Plot (c5) into Zone (c2).
        assert_eq!(dashboard["kpis"][0]["column"], "c1");
        assert_eq!(dashboard["kpis"][0]["label"], "Last pruning");
        assert_eq!(dashboard["summaries"][0]["groupBy"], "c2");
    }

    /// Something unexpected in a database (here a table the step reads is missing) never keeps the app from opening: the
    /// step is left untaken, to be tried again next time.
    #[test]
    fn a_step_that_fails_leaves_the_database_opening_and_is_tried_again() {
        let path = std::env::temp_dir().join(format!("ukmac-upgrade-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let conn = db::open(&path).unwrap();
            conn.execute("DELETE FROM settings WHERE key = ?1", [STEP_KEY]).unwrap();
            conn.execute("INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES ('u', 'Pursat', 'MAC-001')", []).unwrap();
            conn.execute("INSERT INTO sheets (mac_id, title, template_key) VALUES (1, 'Pruning', 'pruning')", []).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF; DROP TABLE google_links;").unwrap();
        }
        let conn = db::open(&path).unwrap();
        assert_eq!(setting(&conn, STEP_KEY), None);
        drop(conn);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn a_new_database_has_nothing_to_do() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate_for_tests(&mut conn);
        run(&mut conn).unwrap();
        assert_eq!(setting(&conn, STEP_KEY).as_deref(), Some(&*STEPS.len().to_string()));
        assert_eq!(setting(&conn, RESYNC_KEY), None);
    }

    #[test]
    fn names_are_matched_as_the_app_matches_headers() {
        assert_eq!(normalize("  Plants   Eligible for Pruning "), "plants eligible for pruning");
        assert_eq!(normalize("\u{feff}Variety name *"), "variety name");
        assert_eq!(normalize("Healthy›Total number  ›  %"), "healthy › total number › %");
    }
}
