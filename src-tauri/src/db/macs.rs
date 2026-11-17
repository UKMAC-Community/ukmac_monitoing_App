//! MAC rows in the database: read, check and build a MAC's workbook.

use rusqlite::{Connection, OptionalExtension};

use crate::db::rows::load_rows;
use crate::db::sheets::load_sheets;
use crate::error::{CmdResult, err};
use crate::models::{Mac, MacInput, SheetWithRows, Workbook};

pub(crate) const MAC_SELECT: &str = "SELECT m.mac_id, m.mac_uuid, m.mac_name, m.mac_code, m.mac_location,
        m.latitude, m.longitude, m.start_date, m.end_date, m.crop, m.note, m.created_at,
        m.updated_at,
        (SELECT COUNT(*) FROM sheets s WHERE s.mac_id = m.mac_id),
        (SELECT COUNT(*) FROM sheet_rows r JOIN sheets s ON s.sheet_id = r.sheet_id
            WHERE s.mac_id = m.mac_id)
    FROM macs m";

pub(crate) fn mac_from_row(row: &rusqlite::Row) -> rusqlite::Result<Mac> {
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

pub(crate) fn workbook(conn: &Connection, mac_id: i64) -> CmdResult<Workbook> {
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

pub(crate) fn clean(text: Option<String>) -> Option<String> {
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
