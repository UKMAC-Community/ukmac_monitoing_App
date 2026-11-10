//! Whose MACs these are.
//!
//! The app shows a Google account only the MACs that account has: one it made, or opened from a
//! `.ukmac` link file with access to the Google Sheets that file points at. A person who signs in
//! with another account, or isn't signed in, sees nothing. This is a lock inside the app: the
//! database is still one plain file on the computer, so it does not stop someone who opens that
//! file with another tool.

use std::collections::HashSet;

use rusqlite::{Connection, params};

use crate::commands::{CmdResult, err};
use crate::google::GoogleState;

pub const SIGN_IN_FIRST: &str = "Sign in with Google to open your MACs.";
pub const NOT_AVAILABLE: &str = "That MAC isn't available to this Google account.";

/// The account's address in the one spelling used here.
pub fn normalize(email: &str) -> String {
    email.trim().to_lowercase()
}

/// The signed-in account, or an error asking for the sign-in.
pub fn require(google: &GoogleState) -> CmdResult<String> {
    google.account().ok_or_else(|| SIGN_IN_FIRST.to_string())
}

pub fn owns(conn: &Connection, email: &str, mac_id: i64) -> CmdResult<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM mac_access WHERE mac_id = ?1 AND email = ?2)",
        params![mac_id, normalize(email)],
        |row| row.get(0),
    )
    .map_err(err)
}

/// The signed-in account has this MAC (an error if not signed in, or if it isn't theirs).
pub fn guard_mac(conn: &Connection, google: &GoogleState, mac_id: i64) -> CmdResult<String> {
    let email = require(google)?;
    if owns(conn, &email, mac_id)? {
        Ok(email)
    } else {
        Err(NOT_AVAILABLE.into())
    }
}

/// The signed-in account has the MAC this table is in.
pub fn guard_sheet(conn: &Connection, google: &GoogleState, sheet_id: i64) -> CmdResult<String> {
    let email = require(google)?;
    let allowed: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sheets s JOIN mac_access a ON a.mac_id = s.mac_id
                           WHERE s.sheet_id = ?1 AND a.email = ?2)",
            params![sheet_id, email],
            |row| row.get(0),
        )
        .map_err(err)?;
    if allowed {
        Ok(email)
    } else {
        Err(NOT_AVAILABLE.into())
    }
}

/// The signed-in account has the MAC of the table an import was made into.
pub fn guard_import(conn: &Connection, google: &GoogleState, import_id: i64) -> CmdResult<String> {
    let sheet_id: Option<i64> = conn
        .query_row("SELECT sheet_id FROM imports WHERE import_id = ?1", [import_id], |row| row.get(0))
        .ok();
    match sheet_id {
        Some(sheet_id) => guard_sheet(conn, google, sheet_id),
        None => Err(NOT_AVAILABLE.into()),
    }
}

pub fn grant(conn: &Connection, mac_id: i64, email: &str) -> CmdResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO mac_access (mac_id, email) VALUES (?1, ?2)",
        params![mac_id, normalize(email)],
    )
    .map_err(err)?;
    Ok(())
}

/// The ids of the MACs this account has.
pub fn owned(conn: &Connection, email: &str) -> CmdResult<HashSet<i64>> {
    let mut statement = conn
        .prepare("SELECT mac_id FROM mac_access WHERE email = ?1")
        .map_err(err)?;
    let ids = statement
        .query_map([normalize(email)], |row| row.get::<_, i64>(0))
        .map_err(err)?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(err)?;
    Ok(ids)
}

/// MACs nobody has yet (made before accounts existed): to the account stored when this version
/// first runs, so the person who has been using the app keeps their farm. Returns how many.
pub fn adopt_unowned(conn: &Connection, email: &str) -> CmdResult<usize> {
    conn.execute(
        "INSERT INTO mac_access (mac_id, email)
         SELECT mac_id, ?1 FROM macs WHERE mac_id NOT IN (SELECT mac_id FROM mac_access)",
        [normalize(email)],
    )
    .map_err(err)
}

/// A MAC nobody has, and the Google Sheets its tables are linked to.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unowned {
    pub mac_id: i64,
    pub mac_name: String,
    pub spreadsheet_ids: Vec<String>,
}

pub fn unowned(conn: &Connection) -> CmdResult<Vec<Unowned>> {
    let mut statement = conn
        .prepare(
            "SELECT m.mac_id, m.mac_name FROM macs m
             WHERE m.mac_id NOT IN (SELECT mac_id FROM mac_access) ORDER BY m.mac_id",
        )
        .map_err(err)?;
    let macs = statement
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut out = Vec::new();
    for (mac_id, mac_name) in macs {
        let mut links = conn
            .prepare(
                "SELECT DISTINCT l.spreadsheet_id FROM google_links l
                 JOIN sheets s ON s.sheet_id = l.sheet_id WHERE s.mac_id = ?1",
            )
            .map_err(err)?;
        let spreadsheet_ids = links
            .query_map([mac_id], |row| row.get::<_, String>(0))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        out.push(Unowned { mac_id, mac_name, spreadsheet_ids });
    }
    Ok(out)
}

/// MACs of other accounts exist in this database (so copying the whole file would copy their data).
pub fn others_exist(conn: &Connection, email: &str) -> CmdResult<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM macs WHERE mac_id NOT IN
                       (SELECT mac_id FROM mac_access WHERE email = ?1))",
        [normalize(email)],
        |row| row.get(0),
    )
    .map_err(err)
}

#[tauri::command]
pub fn unowned_macs(
    db: tauri::State<'_, crate::commands::Db>,
    google: tauri::State<'_, GoogleState>,
) -> CmdResult<Vec<Unowned>> {
    require(&google)?;
    let conn = db.conn.lock().map_err(err)?;
    unowned(&conn)
}

/// The signed-in account takes these MACs, if nobody has them yet (the page checked the Google
/// Sheets of each that has links: the account can open them).
#[tauri::command]
pub fn claim_macs(
    db: tauri::State<'_, crate::commands::Db>,
    google: tauri::State<'_, GoogleState>,
    mac_ids: Vec<i64>,
) -> CmdResult<usize> {
    let email = require(&google)?;
    let conn = db.conn.lock().map_err(err)?;
    let mut taken = 0;
    for mac_id in mac_ids {
        taken += conn
            .execute(
                "INSERT INTO mac_access (mac_id, email)
                 SELECT mac_id, ?2 FROM macs WHERE mac_id = ?1
                   AND mac_id NOT IN (SELECT mac_id FROM mac_access)",
                params![mac_id, email],
            )
            .map_err(err)?;
    }
    Ok(taken)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let path = std::env::temp_dir().join(format!("ukmac-access-test-{}.db", uuid::Uuid::new_v4()));
        crate::db::open(&path).unwrap()
    }

    fn mac(conn: &Connection, uuid: &str, code: &str) -> i64 {
        conn.execute("INSERT INTO macs (mac_uuid, mac_name, mac_code) VALUES (?1, ?1, ?2)", params![uuid, code])
            .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn a_mac_belongs_to_the_accounts_given_it_and_nobody_else() {
        let conn = memory();
        let (a, b) = (mac(&conn, "a", "MAC-A"), mac(&conn, "b", "MAC-B"));
        grant(&conn, a, "Owner@Gmail.com ").unwrap();
        grant(&conn, b, "other@gmail.com").unwrap();
        assert!(owns(&conn, "owner@gmail.com", a).unwrap());
        assert!(!owns(&conn, "owner@gmail.com", b).unwrap());
        assert!(!owns(&conn, "stranger@gmail.com", a).unwrap());
        assert_eq!(owned(&conn, "OWNER@gmail.com").unwrap(), HashSet::from([a]));
        assert!(others_exist(&conn, "owner@gmail.com").unwrap());
    }

    #[test]
    fn existing_macs_go_to_the_account_stored_at_the_upgrade_and_only_once() {
        let conn = memory();
        let (a, b) = (mac(&conn, "a", "MAC-A"), mac(&conn, "b", "MAC-B"));
        grant(&conn, b, "other@gmail.com").unwrap(); // already someone's: left alone
        assert_eq!(adopt_unowned(&conn, "owner@gmail.com").unwrap(), 1);
        assert!(owns(&conn, "owner@gmail.com", a).unwrap());
        assert!(!owns(&conn, "owner@gmail.com", b).unwrap());
        assert_eq!(adopt_unowned(&conn, "late@gmail.com").unwrap(), 0);
        assert!(unowned(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_table_is_reached_only_through_its_macs_account() {
        let conn = memory();
        let a = mac(&conn, "a", "MAC-A");
        conn.execute("INSERT INTO sheets (mac_id, title) VALUES (?1, 'Zones')", [a]).unwrap();
        let sheet = conn.last_insert_rowid();
        grant(&conn, a, "owner@gmail.com").unwrap();
        let allowed = |email: &str| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sheets s JOIN mac_access x ON x.mac_id = s.mac_id
                               WHERE s.sheet_id = ?1 AND x.email = ?2)",
                params![sheet, normalize(email)],
                |row| row.get::<_, bool>(0),
            )
            .unwrap()
        };
        assert!(allowed("owner@gmail.com"));
        assert!(!allowed("other@gmail.com"));
    }
}
