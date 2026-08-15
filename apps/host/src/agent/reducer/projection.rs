use super::SessionState;
use crate::agent::{
    AgentProgressKind, AgentProgressRow, AgentProgressSource, AgentSessionKey, AgentSessionSnapshot,
};

pub(super) fn visible_progress_rows(state: &SessionState) -> Vec<AgentProgressRow> {
    let transcript = state
        .progress_rows_by_source
        .get(&AgentProgressSource::Transcript)
        .cloned()
        .unwrap_or_default();
    let Some(native_plan) = state
        .progress_rows_by_source
        .get(&AgentProgressSource::NativePlan)
        .filter(|rows| !rows.is_empty())
    else {
        return transcript;
    };
    transcript
        .into_iter()
        .filter(|row| row.kind == AgentProgressKind::Goal)
        .chain(native_plan.iter().cloned())
        .collect()
}

pub(super) fn session_snapshot(key: AgentSessionKey, state: &SessionState) -> AgentSessionSnapshot {
    AgentSessionSnapshot {
        key,
        transcript_path: state.transcript_path.clone(),
        turn_lifecycle: state.turn_lifecycle.clone(),
        phase: state.phase,
        detail: state.detail.clone(),
        attention_request_id: state.attention_request_id.clone(),
        hover_messages: state.hover_messages.clone(),
        is_actionable: state.is_actionable,
        progress_rows_by_source: state.progress_rows_by_source.clone(),
        children: state.children.values().cloned().collect(),
        has_pending_background_work: state.has_pending_background_work,
        revision: state.revision,
        working_directory: state.working_directory.clone(),
    }
}
