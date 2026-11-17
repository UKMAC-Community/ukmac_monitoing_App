//! Google sign-in and Google Sheets: status, sign in and out, list, download, open a Google page.

use reqwest::Url;
use tauri::{Manager, State};

use crate::error::CmdResult;
use crate::services::google::{DriveFile, file_id, GoogleState, GoogleStatus, LINK_HOSTS, open_url};

/// A Google page opened for the user (the console to make the OAuth client, a sheet): only https,
/// only Google's own addresses.
#[tauri::command]
pub fn open_link(url: String) -> CmdResult<()> {
    let parsed = Url::parse(&url).map_err(|_| "That isn't a web address.".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if parsed.scheme() != "https" || !LINK_HOSTS.contains(&host) {
        return Err("That address isn't one the app opens.".into());
    }
    open_url(parsed.as_str())
}

#[tauri::command]
pub fn google_status(state: State<'_, GoogleState>) -> GoogleStatus {
    state.status()
}

#[tauri::command]
pub fn google_save_client(
    state: State<'_, GoogleState>,
    client_id: String,
    client_secret: String,
) -> CmdResult<GoogleStatus> {
    state.save_client(&client_id, &client_secret)?;
    Ok(state.status())
}

#[tauri::command]
pub async fn google_sign_in(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> CmdResult<GoogleStatus> {
    state.browser_sign_in().await?;
    // The browser is in front: bring the app back.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(state.status())
}

/// Stops a sign-in that is waiting for the browser.
#[tauri::command]
pub fn google_cancel_sign_in(state: State<'_, GoogleState>) {
    state.cancel_waiting_sign_in();
}

#[tauri::command]
pub async fn google_sign_out(
    state: State<'_, GoogleState>,
    forget_client: Option<bool>,
) -> CmdResult<GoogleStatus> {
    state.sign_out(forget_client.unwrap_or(false)).await?;
    Ok(state.status())
}

/// The user's Google Sheets, newest first (those whose name has `query`, if given).
#[tauri::command]
pub async fn google_list_spreadsheets(
    state: State<'_, GoogleState>,
    query: Option<String>,
) -> CmdResult<Vec<DriveFile>> {
    state.list_spreadsheets(query.as_deref()).await
}

/// A sheet's name and kind, from its link or id.
#[tauri::command]
pub async fn google_file_info(state: State<'_, GoogleState>, file: String) -> CmdResult<DriveFile> {
    let id = file_id(&file)?;
    state.file_info(&id).await
}

/// A sheet as an Excel workbook, from its link or id.
#[tauri::command]
pub async fn google_download(
    state: State<'_, GoogleState>,
    file: String,
) -> CmdResult<tauri::ipc::Response> {
    let id = file_id(&file)?;
    state.download(&id).await.map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_google_pages_are_opened() {
        assert!(open_link("http://console.cloud.google.com/".into()).is_err());
        assert!(open_link("https://example.com/".into()).is_err());
        assert!(open_link("file:///etc/passwd".into()).is_err());
    }
}
