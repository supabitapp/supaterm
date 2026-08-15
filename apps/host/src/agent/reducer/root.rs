use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
};

use super::{SessionState, child::accepts_child};
use crate::agent::{
    AgentAction, AgentActivityPhase, AgentChildKind, AgentEvent, AgentEventOrigin,
    AgentForegroundKey, AgentProgressRow, AgentProgressSource, AgentTurnLifecycle, NativeSessionId,
    NativeTurnId,
};

pub(super) fn accepts(event: &AgentEvent, state: &SessionState, session_exists: bool) -> bool {
    if event.scope.child_id.is_some() {
        return accepts_child(event, state);
    }
    match &event.action {
        AgentAction::SessionStarted { .. }
        | AgentAction::SessionResumed { .. }
        | AgentAction::TurnStarted => true,
        AgentAction::SessionEnded => session_exists,
        AgentAction::TurnCompleted { .. } | AgentAction::TurnContinuesInBackground => {
            state.turn_lifecycle == AgentTurnLifecycle::Unseen
                || targets_active_turn(event.scope.turn_id.as_ref(), state)
        }
        AgentAction::AttentionRequested { .. }
        | AgentAction::ProgressUpdated {
            source: AgentProgressSource::NativePlan,
            ..
        } => {
            state.turn_lifecycle == AgentTurnLifecycle::Unseen
                || targets_active_turn_or_can_adopt(event.scope.turn_id.as_ref(), state)
        }
        AgentAction::TurnRunning { .. } => {
            (state.turn_lifecycle == AgentTurnLifecycle::Unseen
                || targets_active_turn_or_can_adopt(event.scope.turn_id.as_ref(), state))
                && state.phase != AgentActivityPhase::NeedsInput
        }
        AgentAction::AttentionResolved { request_id } => {
            targets_active_turn(event.scope.turn_id.as_ref(), state)
                && state.phase == AgentActivityPhase::NeedsInput
                && request_matches(state.attention_request_id.as_deref(), request_id.as_deref())
        }
        AgentAction::HoverMessagesUpdated { .. }
        | AgentAction::ProgressUpdated {
            source: AgentProgressSource::Transcript,
            ..
        } => accepts_transcript_projection(event.scope.turn_id.as_ref(), state),
        AgentAction::ChildrenReconciled { .. } => true,
        AgentAction::ChildDescribed { .. }
        | AgentAction::ChildStarted { .. }
        | AgentAction::ChildStopped { .. } => false,
    }
}

pub(super) fn bind(event: &AgentEvent, state: &mut SessionState) {
    if event.scope.child_id.is_none()
        && let Some(working_directory) = event
            .working_directory
            .as_deref()
            .and_then(normalized_working_directory)
    {
        state.working_directory = Some(working_directory);
    }
}

pub(super) fn promote_root_if_needed(
    event: &AgentEvent,
    state: &SessionState,
    is_new_session: bool,
    key: &AgentForegroundKey,
    foreground_sessions: &mut HashMap<AgentForegroundKey, NativeSessionId>,
) {
    match event.action {
        AgentAction::TurnStarted => {
            foreground_sessions.insert(key.clone(), event.scope.native_session_id.clone());
        }
        AgentAction::AttentionRequested { .. }
        | AgentAction::ProgressUpdated { .. }
        | AgentAction::TurnContinuesInBackground
        | AgentAction::TurnRunning { .. }
            if !foreground_sessions.contains_key(key)
                || (event.origin == AgentEventOrigin::Native
                    && (is_new_session || !state.is_actionable)) =>
        {
            foreground_sessions.insert(key.clone(), event.scope.native_session_id.clone());
        }
        _ => {}
    }
}

pub(super) fn apply_root(
    event: &AgentEvent,
    state: &mut SessionState,
    foreground_key: &AgentForegroundKey,
    foreground_sessions: &mut HashMap<AgentForegroundKey, NativeSessionId>,
) {
    match &event.action {
        AgentAction::SessionResumed { transcript_path }
        | AgentAction::SessionStarted { transcript_path } => {
            state.transcript_path = transcript_path.clone();
            foreground_sessions.insert(
                foreground_key.clone(),
                event.scope.native_session_id.clone(),
            );
        }
        AgentAction::TurnStarted => start_turn(event.scope.turn_id.clone(), state),
        AgentAction::TurnCompleted { message } => complete_turn(
            event.scope.turn_id.clone(),
            message.as_deref(),
            event.origin == AgentEventOrigin::Native,
            state,
        ),
        AgentAction::TurnContinuesInBackground => continue_turn_in_background(
            event.scope.turn_id.clone(),
            event.origin == AgentEventOrigin::Native,
            state,
        ),
        AgentAction::AttentionRequested {
            request_id,
            message,
        } => request_attention(
            request_id.clone(),
            message.clone(),
            event.scope.turn_id.clone(),
            state,
        ),
        AgentAction::TurnRunning { detail } => run_turn(
            detail.clone(),
            event.scope.turn_id.clone(),
            event.origin == AgentEventOrigin::Native,
            state,
        ),
        AgentAction::AttentionResolved { request_id } => {
            resolve_attention(request_id.as_deref(), event.scope.turn_id.as_ref(), state)
        }
        AgentAction::ChildrenReconciled {
            live_child_ids,
            has_active_teammate,
            has_active_workflow,
        } => state.children.retain(|_, child| match child.kind {
            AgentChildKind::Subagent => live_child_ids.contains(&child.id.child_id),
            AgentChildKind::Teammate => *has_active_teammate,
            AgentChildKind::Unknown => {
                live_child_ids.contains(&child.id.child_id) || *has_active_teammate
            }
            AgentChildKind::Workflow => *has_active_workflow,
        }),
        AgentAction::HoverMessagesUpdated { messages } => {
            update_hover_messages(messages, event.scope.turn_id.as_ref(), state);
        }
        AgentAction::ProgressUpdated { rows, source } => {
            update_progress(rows, *source, event.scope.turn_id.clone(), state);
        }
        AgentAction::SessionEnded
        | AgentAction::ChildDescribed { .. }
        | AgentAction::ChildStarted { .. }
        | AgentAction::ChildStopped { .. } => {}
    }
}

fn start_turn(turn_id: Option<NativeTurnId>, state: &mut SessionState) {
    state
        .children
        .retain(|identity, _| identity.turn_id == turn_id);
    state.turn_lifecycle = AgentTurnLifecycle::Active(turn_id);
    state.is_actionable = true;
    state.phase = AgentActivityPhase::Running;
    state.detail = None;
    state.attention_request_id = None;
    state.hover_messages.clear();
    state.progress_rows_by_source.clear();
}

fn complete_turn(
    turn_id: Option<NativeTurnId>,
    message: Option<&str>,
    makes_actionable: bool,
    state: &mut SessionState,
) {
    if state.turn_lifecycle == AgentTurnLifecycle::Unseen {
        state.turn_lifecycle = AgentTurnLifecycle::Completed(turn_id);
    } else {
        if !targets_active_turn(turn_id.as_ref(), state) {
            return;
        }
        state.turn_lifecycle = AgentTurnLifecycle::Completed(turn_id);
    }
    state.has_pending_background_work = false;
    state.is_actionable |= makes_actionable;
    state.phase = AgentActivityPhase::Idle;
    state.detail = None;
    state.attention_request_id = None;
    state.progress_rows_by_source.clear();
    if let Some(message) = message.and_then(normalized_message) {
        state.hover_messages = vec![message];
    }
}

fn continue_turn_in_background(
    turn_id: Option<NativeTurnId>,
    makes_actionable: bool,
    state: &mut SessionState,
) {
    recover_turn_if_needed(turn_id.clone(), state);
    if !targets_active_turn(turn_id.as_ref(), state) {
        return;
    }
    state.has_pending_background_work = true;
    state.is_actionable |= makes_actionable;
    state.phase = AgentActivityPhase::Running;
    state.detail = None;
    state.attention_request_id = None;
}

fn request_attention(
    request_id: Option<String>,
    message: Option<String>,
    turn_id: Option<NativeTurnId>,
    state: &mut SessionState,
) {
    recover_turn_if_needed(turn_id.clone(), state);
    if !targets_active_turn(turn_id.as_ref(), state) {
        return;
    }
    state.is_actionable = true;
    state.phase = AgentActivityPhase::NeedsInput;
    state.detail = message;
    state.attention_request_id = request_id;
}

fn run_turn(
    detail: Option<String>,
    turn_id: Option<NativeTurnId>,
    makes_actionable: bool,
    state: &mut SessionState,
) {
    recover_turn_if_needed(turn_id.clone(), state);
    if !targets_active_turn(turn_id.as_ref(), state)
        || state.phase == AgentActivityPhase::NeedsInput
    {
        return;
    }
    state.is_actionable |= makes_actionable;
    state.phase = AgentActivityPhase::Running;
    state.detail = detail;
}

fn resolve_attention(
    request_id: Option<&str>,
    turn_id: Option<&NativeTurnId>,
    state: &mut SessionState,
) {
    if !targets_active_turn(turn_id, state)
        || state.phase != AgentActivityPhase::NeedsInput
        || !request_matches(state.attention_request_id.as_deref(), request_id)
    {
        return;
    }
    state.is_actionable = true;
    state.phase = AgentActivityPhase::Running;
    state.detail = None;
    state.attention_request_id = None;
}

fn update_progress(
    rows: &[AgentProgressRow],
    source: AgentProgressSource,
    turn_id: Option<NativeTurnId>,
    state: &mut SessionState,
) {
    if source == AgentProgressSource::NativePlan {
        recover_turn_if_needed(turn_id.clone(), state);
        if !targets_active_turn(turn_id.as_ref(), state) {
            return;
        }
        state.is_actionable = true;
    } else if !accepts_transcript_projection(turn_id.as_ref(), state) {
        return;
    }
    state.progress_rows_by_source.insert(source, rows.to_vec());
}

fn update_hover_messages(
    messages: &[String],
    turn_id: Option<&NativeTurnId>,
    state: &mut SessionState,
) {
    if !accepts_transcript_projection(turn_id, state) {
        return;
    }
    state.hover_messages = messages
        .iter()
        .filter_map(|message| normalized_message(message))
        .collect();
}

fn accepts_transcript_projection(turn_id: Option<&NativeTurnId>, state: &SessionState) -> bool {
    match &state.turn_lifecycle {
        AgentTurnLifecycle::Unseen => true,
        AgentTurnLifecycle::Active(active_turn_id) => {
            turn_id.is_none() || active_turn_id.as_ref() == turn_id
        }
        AgentTurnLifecycle::Completed(_) => false,
    }
}

fn recover_turn_if_needed(turn_id: Option<NativeTurnId>, state: &mut SessionState) {
    match &state.turn_lifecycle {
        AgentTurnLifecycle::Unseen => {
            state.turn_lifecycle = AgentTurnLifecycle::Active(turn_id);
            state.phase = AgentActivityPhase::Running;
        }
        AgentTurnLifecycle::Active(None) if turn_id.is_some() => {
            state.turn_lifecycle = AgentTurnLifecycle::Active(turn_id);
        }
        AgentTurnLifecycle::Active(_) | AgentTurnLifecycle::Completed(_) => {}
    }
}

fn targets_active_turn(turn_id: Option<&NativeTurnId>, state: &SessionState) -> bool {
    match &state.turn_lifecycle {
        AgentTurnLifecycle::Active(active_turn_id) => {
            turn_id.is_none() || active_turn_id.as_ref() == turn_id
        }
        AgentTurnLifecycle::Unseen | AgentTurnLifecycle::Completed(_) => false,
    }
}

fn targets_active_turn_or_can_adopt(turn_id: Option<&NativeTurnId>, state: &SessionState) -> bool {
    match &state.turn_lifecycle {
        AgentTurnLifecycle::Active(active_turn_id) => {
            active_turn_id.is_none() || turn_id.is_none() || active_turn_id.as_ref() == turn_id
        }
        AgentTurnLifecycle::Unseen | AgentTurnLifecycle::Completed(_) => false,
    }
}

fn request_matches(stored: Option<&str>, incoming: Option<&str>) -> bool {
    stored.is_none() || stored == incoming
}

fn normalized_working_directory(path: &Path) -> Option<PathBuf> {
    let path = path.to_string_lossy();
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !normalized.has_root() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    Some(normalized)
}

fn normalized_message(message: &str) -> Option<String> {
    let message = message.trim();
    (!message.is_empty()).then(|| message.to_owned())
}
