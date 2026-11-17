//! The optional AI connection and its dashboard suggestions.

use tauri::State;

use crate::error::CmdResult;
use crate::services::ai::{AiConnectionInput, AiGenerationInput, AiState, AiStatus, ConnectionTest};

#[tauri::command]
pub fn ai_status(state: State<'_, AiState>) -> CmdResult<AiStatus> {
    state.status()
}

#[tauri::command]
pub fn ai_save_connection(
    state: State<'_, AiState>,
    input: AiConnectionInput,
) -> CmdResult<AiStatus> {
    state.save(input)
}

#[tauri::command]
pub fn ai_clear_connection(state: State<'_, AiState>) -> CmdResult<AiStatus> {
    state.clear()
}

#[tauri::command]
pub fn ai_cancel_generation(state: State<'_, AiState>, request_id: String) -> CmdResult<()> {
    state.cancel_request(&request_id)
}

#[tauri::command]
pub async fn ai_generate_visuals(
    state: State<'_, AiState>,
    input: AiGenerationInput,
) -> CmdResult<String> {
    state.generate_visuals(&input).await
}

#[tauri::command]
pub async fn ai_test_connection(state: State<'_, AiState>) -> CmdResult<ConnectionTest> {
    state.test_connection().await
}
