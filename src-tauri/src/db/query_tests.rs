//! The database queries the commands share: tables with their keys, rows in order, renamed tables.

use rusqlite::Connection;
use serde_json::{Map, Value};

use crate::db::rows::{insert_rows, load_rows, set_row_order};
use crate::db::sheets::{assign_keys, insert_sheet, load_sheets, replace_ref};
use crate::models::Column;
use crate::services::template;

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
    // Every table starts with its ID (c1), numbered by the app; the 287 columns of the sheet follow.
    assert_eq!(qc.columns[0].name, "ID");
    assert!(qc.columns[0].auto);
    assert_eq!(qc.columns[0].key, "c1");
    assert_eq!(qc.columns.last().unwrap().key, "c288");
    assert!(qc.dashboard.is_none());
}

#[test]
fn rows_added_to_a_template_table_are_numbered_by_the_app() {
    let mut conn = memory();
    let mac_id = mac(&conn);
    let tx = conn.transaction().unwrap();
    for (order, sheet) in template::chili_template().into_iter().enumerate() {
        insert_sheet(&tx, mac_id, sheet.title, sheet.heading, Some(sheet.icon), sheet.about, Some(sheet.key), sheet.columns, order as i64).unwrap();
    }
    tx.commit().unwrap();
    let batch = load_sheets(&conn, mac_id).unwrap().into_iter().find(|s| s.title == "Batch").unwrap();
    let (id, number) = (batch.columns[0].key.clone(), batch.columns[1].key.clone());
    let row = |text: &str| {
        let mut cells = Map::new();
        cells.insert(number.clone(), Value::String(text.into()));
        cells
    };
    let tx = conn.transaction().unwrap();
    insert_rows(&tx, batch.sheet_id, vec![row("B1"), row("B2")], None, None).unwrap();
    // A later row, even one put at the top, is numbered after them, and one that comes with its number keeps it.
    insert_rows(&tx, batch.sheet_id, vec![row("B3")], Some(0), None).unwrap();
    let mut given = row("B9");
    given.insert(id.clone(), Value::String("9".into()));
    insert_rows(&tx, batch.sheet_id, vec![given, row("B10")], None, None).unwrap();
    tx.commit().unwrap();
    let rows = load_rows(&conn, batch.sheet_id).unwrap();
    let seen: Vec<(String, String)> = rows
        .iter()
        .map(|row| (row.data[&number].as_str().unwrap().to_string(), row.data[&id].as_str().unwrap().to_string()))
        .collect();
    assert_eq!(
        seen,
        [("B3", "3"), ("B1", "1"), ("B2", "2"), ("B9", "9"), ("B10", "10")].map(|(a, b)| (a.to_string(), b.to_string()))
    );
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

