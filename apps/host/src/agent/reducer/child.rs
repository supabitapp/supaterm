use super::SessionState;
use crate::agent::{AgentAction, AgentActivityPhase, AgentChild, AgentChildIdentity, AgentEvent};

pub(super) fn accepts_child(event: &AgentEvent, state: &SessionState) -> bool {
    let Some(key) = child_key(event) else {
        return false;
    };
    if matches!(event.action, AgentAction::ChildStarted { .. }) {
        return true;
    }
    let Some(child) = state.children.get(&key) else {
        return false;
    };
    match &event.action {
        AgentAction::ChildDescribed { .. }
        | AgentAction::ChildStopped { .. }
        | AgentAction::AttentionRequested { .. }
        | AgentAction::TurnStarted
        | AgentAction::TurnContinuesInBackground => true,
        AgentAction::AttentionResolved { request_id } => {
            child.phase == AgentActivityPhase::NeedsInput
                && (child.attention_request_id.is_none()
                    || child.attention_request_id == *request_id)
        }
        AgentAction::TurnRunning { .. } => child.phase != AgentActivityPhase::NeedsInput,
        AgentAction::HoverMessagesUpdated { .. }
        | AgentAction::ProgressUpdated { .. }
        | AgentAction::SessionEnded
        | AgentAction::SessionResumed { .. }
        | AgentAction::SessionStarted { .. }
        | AgentAction::ChildStarted { .. }
        | AgentAction::ChildrenReconciled { .. }
        | AgentAction::TurnCompleted { .. } => false,
    }
}

pub(super) fn apply_child(event: &AgentEvent, state: &mut SessionState) {
    let Some(key) = child_key(event) else {
        return;
    };
    match &event.action {
        AgentAction::ChildStarted {
            kind,
            nickname,
            role,
            task,
            transcript_path,
            usage,
        } => {
            state
                .children
                .retain(|identity, _| identity.child_id != key.child_id || identity == &key);
            if let Some(child) = state.children.get_mut(&key) {
                child.kind = *kind;
                update_if_some(&mut child.nickname, nickname);
                update_if_some(&mut child.role, role);
                update_if_some(&mut child.task, task);
                update_if_some(&mut child.transcript_path, transcript_path);
                update_if_some(&mut child.usage, usage);
                if child.phase == AgentActivityPhase::Idle {
                    child.phase = AgentActivityPhase::Running;
                    child.detail = None;
                    child.attention_request_id = None;
                }
            } else {
                state.children.insert(
                    key.clone(),
                    AgentChild {
                        id: key,
                        kind: *kind,
                        nickname: nickname.clone(),
                        role: role.clone(),
                        transcript_path: transcript_path.clone(),
                        task: task.clone(),
                        phase: AgentActivityPhase::Running,
                        detail: None,
                        attention_request_id: None,
                        usage: usage.clone(),
                    },
                );
            }
        }
        AgentAction::ChildDescribed {
            kind,
            nickname,
            task,
            transcript_path,
            usage,
        } => {
            let Some(child) = state.children.get_mut(&key) else {
                return;
            };
            if let Some(kind) = kind {
                child.kind = *kind;
            }
            update_if_some(&mut child.nickname, nickname);
            update_if_some(&mut child.task, task);
            update_if_some(&mut child.transcript_path, transcript_path);
            update_if_some(&mut child.usage, usage);
        }
        AgentAction::ChildStopped { usage } => {
            let Some(child) = state.children.get_mut(&key) else {
                return;
            };
            if child.runs_in_workflow() {
                child.phase = AgentActivityPhase::Idle;
                child.detail = None;
                child.attention_request_id = None;
                update_if_some(&mut child.usage, usage);
            } else {
                state.children.remove(&key);
            }
        }
        action => update_child(action, &key, state),
    }
}

fn update_child(action: &AgentAction, key: &AgentChildIdentity, state: &mut SessionState) {
    let Some(child) = state.children.get_mut(key) else {
        return;
    };
    match action {
        AgentAction::AttentionRequested {
            request_id,
            message,
        } => {
            child.phase = AgentActivityPhase::NeedsInput;
            child.detail = message.clone();
            child.attention_request_id = request_id.clone();
        }
        AgentAction::AttentionResolved { request_id }
            if child.phase == AgentActivityPhase::NeedsInput
                && (child.attention_request_id.is_none()
                    || child.attention_request_id == *request_id) =>
        {
            child.phase = AgentActivityPhase::Running;
            child.detail = None;
            child.attention_request_id = None;
        }
        AgentAction::TurnStarted | AgentAction::TurnContinuesInBackground => {
            child.phase = AgentActivityPhase::Running;
            child.detail = None;
            child.attention_request_id = None;
        }
        AgentAction::TurnRunning { detail } if child.phase != AgentActivityPhase::NeedsInput => {
            child.phase = AgentActivityPhase::Running;
            child.detail = detail.clone();
            child.attention_request_id = None;
        }
        _ => {}
    }
}

fn child_key(event: &AgentEvent) -> Option<AgentChildIdentity> {
    Some(AgentChildIdentity {
        child_id: event.scope.child_id.clone()?,
        native_session_id: event.scope.native_session_id.clone(),
        turn_id: event.scope.turn_id.clone(),
    })
}

fn update_if_some<T: Clone>(target: &mut Option<T>, update: &Option<T>) {
    if let Some(update) = update {
        *target = Some(update.clone());
    }
}
