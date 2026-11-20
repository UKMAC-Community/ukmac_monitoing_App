//! A MAC as one text key: copied from a MAC here, pasted on another computer (see `services::mac_key`).
//!
//! A key opens only for a Google account that can open every Google Sheet it points at. The check is made here, before
//! anything of the key is added or shown, so an account without access gets a refusal and nothing else.

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::{CmdResult, err};
use crate::services::google::GoogleState;
use crate::services::mac_file::{Imported, MacFile, Peek, build, import_as, peek, unlinked_with_rows};
use crate::services::mac_key;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MadeKey {
    pub key: String,
    pub sheets: usize,
    pub linked: usize,
    /// Tables that hold rows here but are not linked to Google: they arrive empty.
    pub empty_on_open: Vec<String>,
}

/// The MAC's tables and their Google links as one key. No rows go into it.
#[tauri::command]
pub fn export_mac_key(db: State<'_, Db>, google: State<'_, GoogleState>, mac_id: i64) -> CmdResult<MadeKey> {
    let (file, empty_on_open) = {
        let conn = db.conn.lock().map_err(err)?;
        crate::services::access::guard_mac(&conn, &google, mac_id)?;
        (build(&conn, mac_id)?, unlinked_with_rows(&conn, mac_id)?)
    };
    Ok(MadeKey {
        key: mac_key::encode(&file)?,
        sheets: file.sheets.len(),
        linked: file.sheets.iter().filter(|sheet| sheet.google_link.is_some()).count(),
        empty_on_open,
    })
}

/// Reads a key, once the signed-in account is shown to be able to open every sheet it points at.
async fn open_key(google: &GoogleState, key: &str) -> CmdResult<(MacFile, String)> {
    let email = crate::services::access::require(google)?;
    let file = mac_key::decode(key)?;
    let mut seen: Vec<&str> = Vec::new();
    for sheet in &file.sheets {
        let Some(link) = &sheet.google_link else { continue };
        if seen.contains(&link.spreadsheet_id.as_str()) {
            continue;
        }
        seen.push(&link.spreadsheet_id);
        if let Err(error) = google.file_info(&link.spreadsheet_id).await {
            return Err(refusal(&email, &link.spreadsheet_title, &error));
        }
    }
    Ok((file, email))
}

/// The words for a sheet that couldn't be opened: no access (the account is blocked) or Google couldn't be reached.
fn refusal(email: &str, title: &str, error: &str) -> String {
    let lower = error.to_lowercase();
    let blocked = ["can't open it", "didn't let this account", "share it with you", "can't find that sheet"]
        .iter()
        .any(|phrase| lower.contains(phrase));
    let title = if title.is_empty() { "a Google Sheet" } else { title };
    if blocked {
        format!(
            "No access. The Google account {email} can't open the Google Sheet “{title}”, so this key adds nothing. Ask the owner to share the sheet with this account, then paste the key again."
        )
    } else {
        format!("Could not check the Google Sheet “{title}”, so nothing was added: {error}")
    }
}

/// What a key holds, and whether this computer already has that MAC. Nothing is shown to an account that can't open the sheets.
#[tauri::command]
pub async fn peek_mac_key(db: State<'_, Db>, google: State<'_, GoogleState>, key: String) -> CmdResult<Peek> {
    let (file, email) = open_key(&google, &key).await?;
    let conn = db.conn.lock().map_err(err)?;
    peek(&conn, &file, Some(&email))
}

/// Adds the MAC in the key (see `import_as`), after the same check.
#[tauri::command]
pub async fn import_mac_key(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    key: String,
    replace: bool,
) -> CmdResult<Imported> {
    let (file, email) = open_key(&google, &key).await?;
    let mut conn = db.conn.lock().map_err(err)?;
    import_as(&mut conn, file, replace, Some(&email))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sheet_the_account_cannot_open_blocks_the_key() {
        let text = refusal("a@b.com", "Farm data", "Google says it can't open it with this account.");
        assert!(text.starts_with("No access."));
        assert!(text.contains("a@b.com") && text.contains("Farm data") && text.contains("adds nothing"));
    }

    #[test]
    fn a_network_failure_is_not_called_no_access() {
        let text = refusal("a@b.com", "", "no internet");
        assert!(!text.starts_with("No access."));
        assert!(text.contains("a Google Sheet"));
    }
}
