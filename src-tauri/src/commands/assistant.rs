//! The local assistant: download it, start it, ask it (see `services::assistant`).

use tauri::{AppHandle, State};

use crate::db::Db;
use crate::error::{CmdResult, err};
use crate::services::assistant::{AssistantState, AssistantStatus};
use crate::services::google::GoogleState;

/// How the assistant is told to answer. The app has already searched the tables and worked out the numbers (QUERY RESULTS) and found
/// matching records: the model's part is only to put them into plain words, so it is told to copy, not to calculate or reason.
const SYSTEM: &str = "You are the assistant of a chili farm's monitoring app. The app has already searched the farm's tables for the QUESTION and computed exact results. You are given QUERY RESULTS (numbers the app computed: copy them exactly, never calculate or change them) and sometimes RECORDS grouped by plot (each line: a date, the table, then what it says). Answer in one to four plain sentences, using only those results and records: copy names, numbers and dates exactly and add no number, unit or word that is not there. For a breakdown, give every group. For RECORDS, write one line for every plot and one for the records with no plot, covering all of their records. If they do not answer the question, say so in one sentence. English only. Do not say anything is missing or wrong unless a result says so: the app checks that separately.\n\nExample 1\nQUERY RESULTS (exact, computed by the app):\n1. Count of plots in Zones\n   165 plots in total\n   By Zone — A: 55\n   By Zone — B: 55\n   By Zone — C: 55\nQUESTION: how many plots are in each zone?\nANSWER: There are 165 plots in total: Zone A has 55, Zone B has 55 and Zone C has 55.\n\nExample 2\nRECORDS:\nPLOT C3 (planted 02/06/2026):\n- 05/07/2026 Irrigation — Duration: 2 h\n- 05/07/2026 Pruning — Note: top shoots\nRECORDS WITH NO PLOT:\n- 05/07/2026 Pesticides — Product: Neem\nQUESTION: What happened on 5 Jul?\nANSWER: Plot C3: irrigated for 2 h and pruned (top shoots). No plot: Pesticides, Product Neem.";

#[tauri::command]
pub fn assistant_status(state: State<'_, AssistantState>) -> AssistantStatus {
    state.status()
}

/// Downloads what is missing (progress comes as `assistant-progress` events). Returns when it is all in place and checked.
#[tauri::command]
pub async fn assistant_install(app: AppHandle, state: State<'_, AssistantState>) -> CmdResult<AssistantStatus> {
    state.install(&app).await?;
    Ok(state.status())
}

#[tauri::command]
pub fn assistant_cancel(state: State<'_, AssistantState>) {
    state.cancel();
}

#[tauri::command]
pub async fn assistant_start(state: State<'_, AssistantState>) -> CmdResult<AssistantStatus> {
    state.start().await?;
    Ok(state.status())
}

#[tauri::command]
pub fn assistant_stop(state: State<'_, AssistantState>) -> AssistantStatus {
    state.stop();
    state.status()
}

#[tauri::command]
pub fn assistant_remove(state: State<'_, AssistantState>) -> CmdResult<AssistantStatus> {
    state.remove()?;
    Ok(state.status())
}

/// Asks about a MAC's data. `context` is what the app found in the tables for this question (query results and records); it goes
/// only to the assistant running on this computer.
#[tauri::command]
pub async fn assistant_ask(
    db: State<'_, Db>,
    google: State<'_, GoogleState>,
    state: State<'_, AssistantState>,
    mac_id: i64,
    context: String,
    question: String,
) -> CmdResult<String> {
    {
        let conn = db.conn.lock().map_err(err)?;
        crate::services::access::guard_mac(&conn, &google, mac_id)?;
    }
    if question.trim().is_empty() {
        return Err("Ask something first.".into());
    }
    state.ask(SYSTEM, &context, &question).await
}
