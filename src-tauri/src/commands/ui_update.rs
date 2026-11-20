//! UI-only updates (see `services::ui_update`): look for a newer package of screens, keep it, load it into the window.

use tauri::{AppHandle, State};

use crate::error::CmdResult;
use crate::services::ui_update::{self, Look, UiState};

/// Which screens the window has, and whether a newer package of them can go in without a restart.
#[tauri::command]
pub async fn ui_update_look(state: State<'_, UiState>) -> CmdResult<Look> {
    ui_update::look(&state).await
}

/// Download the newest package of screens, check its signature and keep it (it opens next time). Returns its version.
#[tauri::command]
pub async fn ui_update_install(app: AppHandle, state: State<'_, UiState>) -> CmdResult<String> {
    ui_update::install(&app, &state).await
}

/// Give the window the kept package's screens; the caller reloads the window next. If they don't start, the old ones come back.
#[tauri::command]
pub fn ui_update_apply(app: AppHandle, state: State<'_, UiState>) -> CmdResult<String> {
    ui_update::apply(&app, &state)
}

/// The screens of `version` started.
#[tauri::command]
pub fn ui_booted(state: State<'_, UiState>, version: String) {
    state.booted(&version);
}
