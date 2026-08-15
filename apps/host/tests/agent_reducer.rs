pub use supaterm_host::TerminalId;

#[path = "../src/agent/mod.rs"]
pub mod agent;

use std::{collections::BTreeSet, num::NonZeroUsize, path::PathBuf, str::FromStr};

use agent::{
    AgentAction, AgentActivityPhase, AgentChildKind, AgentDelivery, AgentDeliveryId, AgentEvent,
    AgentEventOrigin, AgentEventScope, AgentKind, AgentProgressKind, AgentProgressRow,
    AgentProgressSource, AgentProgressStatus, AgentSessionKey, AgentState, AgentStateSnapshot,
    AgentTurnLifecycle, NativeChildId, NativeSessionId, NativeTurnId,
};

#[test]
fn root_lifecycle_enforces_attention_and_stale_turns() {
    let mut state = AgentState::new();
    assert_changed(state.apply_event(event(
        "session-1",
        None,
        None,
        AgentAction::SessionStarted {
            transcript_path: Some("/tmp/session.jsonl".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnStarted,
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::AttentionRequested {
            request_id: Some("id:call-1".into()),
            message: Some("Approve".into()),
        },
        AgentEventOrigin::Native,
    )));

    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnRunning {
            detail: Some("Must stay blocked".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::AttentionResolved {
            request_id: Some("tool:Bash".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::AttentionResolved {
            request_id: Some("id:call-1".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnContinuesInBackground,
        AgentEventOrigin::Native,
    )));
    assert!(state.has_background_work(&session_key("session-1")));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnCompleted {
            message: Some("  Done  ".into()),
        },
        AgentEventOrigin::Native,
    )));

    let presentation = state.presentation(terminal_id(), AgentKind::Codex).unwrap();
    assert_eq!(presentation.phase, AgentActivityPhase::Idle);
    assert_eq!(presentation.hover_messages, ["Done"]);
    assert_eq!(
        presentation.turn_lifecycle,
        AgentTurnLifecycle::Completed(Some(turn_id("turn-1")))
    );
    assert!(!state.has_background_work(&session_key("session-1")));
    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnRunning {
            detail: Some("Late".into()),
        },
        AgentEventOrigin::Native,
    )));
}

#[test]
fn nil_turn_ids_keep_swift_targeting_rules() {
    let mut state = AgentState::new();
    apply_start(&mut state, "session-1");
    assert_changed(state.apply_event(event(
        "session-1",
        None,
        None,
        AgentAction::TurnStarted,
        AgentEventOrigin::Native,
    )));
    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::ProgressUpdated {
            rows: vec![task("late", AgentProgressStatus::Running)],
            source: AgentProgressSource::Transcript,
        },
        AgentEventOrigin::Transcript,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnRunning {
            detail: Some("Adopted".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_eq!(
        state
            .session(&session_key("session-1"))
            .unwrap()
            .turn_lifecycle,
        AgentTurnLifecycle::Active(Some(turn_id("turn-1")))
    );
    assert_changed(state.apply_event(event(
        "session-1",
        None,
        None,
        AgentAction::TurnCompleted { message: None },
        AgentEventOrigin::Native,
    )));
    assert_eq!(
        state
            .session(&session_key("session-1"))
            .unwrap()
            .turn_lifecycle,
        AgentTurnLifecycle::Completed(None)
    );
    assert_rejected(state.apply_event(event(
        "session-1",
        None,
        None,
        AgentAction::TurnRunning {
            detail: Some("Late nil".into()),
        },
        AgentEventOrigin::Native,
    )));
}

#[test]
fn progress_hover_and_child_phase_form_one_projection() {
    let mut state = AgentState::new();
    apply_start(&mut state, "session-1");
    apply_turn_start(&mut state, "session-1", "turn-1");
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::ProgressUpdated {
            rows: vec![
                goal("goal"),
                task("transcript-task", AgentProgressStatus::Running),
            ],
            source: AgentProgressSource::Transcript,
        },
        AgentEventOrigin::Transcript,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::ProgressUpdated {
            rows: vec![task("native-plan", AgentProgressStatus::Pending)],
            source: AgentProgressSource::NativePlan,
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::HoverMessagesUpdated {
            messages: vec!["  First  ".into(), "\n".into(), "Second".into()],
        },
        AgentEventOrigin::Transcript,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::ChildStarted {
            kind: AgentChildKind::Subagent,
            nickname: None,
            role: Some("reviewer".into()),
            task: Some("Review state".into()),
            transcript_path: None,
            usage: None,
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::AttentionRequested {
            request_id: None,
            message: None,
        },
        AgentEventOrigin::Native,
    )));

    let presentation = state.presentation(terminal_id(), AgentKind::Codex).unwrap();
    assert_eq!(presentation.phase, AgentActivityPhase::NeedsInput);
    assert_eq!(presentation.detail.as_deref(), Some("Review state"));
    assert_eq!(presentation.hover_messages, ["First", "Second"]);
    assert_eq!(
        presentation
            .progress_rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        ["goal", "native-plan"]
    );

    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::ProgressUpdated {
            rows: vec![],
            source: AgentProgressSource::Transcript,
        },
        AgentEventOrigin::Transcript,
    )));
    assert_eq!(
        state
            .presentation(terminal_id(), AgentKind::Codex)
            .unwrap()
            .progress_rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        ["native-plan"]
    );
}

#[test]
fn session_start_resets_resume_preserves_and_old_end_keeps_foreground() {
    let mut state = AgentState::new();
    apply_start(&mut state, "older");
    apply_turn_start(&mut state, "older", "turn-1");
    assert_changed(state.apply_event(event(
        "older",
        Some("turn-1"),
        None,
        AgentAction::AttentionRequested {
            request_id: None,
            message: Some("Keep me".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "older",
        None,
        None,
        AgentAction::SessionResumed {
            transcript_path: Some("/tmp/resumed.jsonl".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_eq!(
        state.session(&session_key("older")).unwrap().phase,
        AgentActivityPhase::NeedsInput
    );

    apply_start(&mut state, "foreground");
    assert_eq!(
        state
            .foreground_session_id(terminal_id(), AgentKind::Codex)
            .unwrap()
            .as_str(),
        "foreground"
    );
    assert_changed(state.apply_event(event(
        "older",
        None,
        None,
        AgentAction::SessionEnded,
        AgentEventOrigin::Native,
    )));
    assert_eq!(
        state
            .foreground_session_id(terminal_id(), AgentKind::Codex)
            .unwrap()
            .as_str(),
        "foreground"
    );

    apply_turn_start(&mut state, "foreground", "turn-2");
    assert_changed(state.apply_event(event(
        "foreground",
        None,
        None,
        AgentAction::SessionStarted {
            transcript_path: Some("/tmp/fresh.jsonl".into()),
        },
        AgentEventOrigin::Native,
    )));
    let fresh = state.session(&session_key("foreground")).unwrap();
    assert_eq!(fresh.turn_lifecycle, AgentTurnLifecycle::Unseen);
    assert_eq!(fresh.phase, AgentActivityPhase::Idle);
    assert!(!fresh.is_actionable);
}

#[test]
fn child_lifetimes_merge_metadata_and_reject_stale_events() {
    let mut state = AgentState::new();
    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        child_start(AgentChildKind::Subagent, None, None),
        AgentEventOrigin::Native,
    )));
    apply_start(&mut state, "session-1");
    apply_turn_start(&mut state, "session-1", "turn-1");
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        child_start(AgentChildKind::Unknown, None, Some("Initial task")),
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::AttentionRequested {
            request_id: Some("request-1".into()),
            message: Some("Choose".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        child_start(
            AgentChildKind::Subagent,
            Some("Reviewer"),
            Some("Updated task"),
        ),
        AgentEventOrigin::Native,
    )));
    let child = &state.session(&session_key("session-1")).unwrap().children[0];
    assert_eq!(child.phase, AgentActivityPhase::NeedsInput);
    assert_eq!(child.nickname.as_deref(), Some("Reviewer"));
    assert_eq!(child.task.as_deref(), Some("Updated task"));

    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::TurnRunning {
            detail: Some("Cannot clear attention".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::AttentionResolved {
            request_id: Some("wrong".into()),
        },
        AgentEventOrigin::Native,
    )));
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::AttentionResolved {
            request_id: Some("request-1".into()),
        },
        AgentEventOrigin::Native,
    )));

    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-2"),
        Some("child-1"),
        child_start(AgentChildKind::Subagent, Some("New lifetime"), None),
        AgentEventOrigin::Native,
    )));
    assert_rejected(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("child-1"),
        AgentAction::ChildStopped { usage: None },
        AgentEventOrigin::Native,
    )));
    let children = state.session(&session_key("session-1")).unwrap().children;
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].id.turn_id, Some(turn_id("turn-2")));
}

#[test]
fn reconciliation_and_workflow_stop_keep_only_live_children() {
    let mut state = AgentState::new();
    apply_start(&mut state, "session-1");
    apply_turn_start(&mut state, "session-1", "turn-1");
    for (child_id, kind) in [
        ("subagent-live", AgentChildKind::Subagent),
        ("subagent-dead", AgentChildKind::Subagent),
        ("teammate", AgentChildKind::Teammate),
        ("unknown", AgentChildKind::Unknown),
        ("workflow", AgentChildKind::Workflow),
    ] {
        assert_changed(state.apply_event(event(
            "session-1",
            Some("turn-1"),
            Some(child_id),
            child_start(kind, None, None),
            AgentEventOrigin::Native,
        )));
    }
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        Some("workflow"),
        AgentAction::ChildStopped { usage: None },
        AgentEventOrigin::Native,
    )));
    assert_eq!(
        state
            .session(&session_key("session-1"))
            .unwrap()
            .children
            .iter()
            .find(|child| child.id.child_id.as_str() == "workflow")
            .unwrap()
            .phase,
        AgentActivityPhase::Idle
    );
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::ChildrenReconciled {
            live_child_ids: BTreeSet::from([child_id("subagent-live")]),
            has_active_teammate: false,
            has_active_workflow: true,
        },
        AgentEventOrigin::Native,
    )));
    assert_eq!(
        state
            .session(&session_key("session-1"))
            .unwrap()
            .children
            .iter()
            .map(|child| child.id.child_id.as_str())
            .collect::<Vec<_>>(),
        ["subagent-live", "workflow"]
    );
}

#[test]
fn working_directory_is_lexical_and_owned_by_the_root() {
    let mut state = AgentState::new();
    let mut start = event(
        "session-1",
        None,
        None,
        AgentAction::SessionStarted {
            transcript_path: None,
        },
        AgentEventOrigin::Native,
    );
    start.working_directory = Some("/tmp/first/child/..".into());
    assert_changed(state.apply_event(start));

    let mut child = event(
        "session-1",
        None,
        Some("child-1"),
        child_start(AgentChildKind::Subagent, None, None),
        AgentEventOrigin::Native,
    );
    child.working_directory = Some("/tmp/child".into());
    assert_changed(state.apply_event(child));
    assert_eq!(
        state
            .session(&session_key("session-1"))
            .unwrap()
            .working_directory,
        Some(PathBuf::from("/tmp/first"))
    );

    let mut running = event(
        "session-1",
        None,
        None,
        AgentAction::TurnRunning { detail: None },
        AgentEventOrigin::Native,
    );
    running.working_directory = Some("/tmp/second".into());
    assert_changed(state.apply_event(running));
    assert_eq!(
        state
            .session(&session_key("session-1"))
            .unwrap()
            .working_directory,
        Some(PathBuf::from("/tmp/second"))
    );
}

#[test]
fn equal_events_do_not_advance_revision_but_foreground_changes_do() {
    let mut state = AgentState::new();
    apply_start(&mut state, "session-1");
    apply_turn_start(&mut state, "session-1", "turn-1");
    let running = event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnRunning {
            detail: Some("Bash".into()),
        },
        AgentEventOrigin::Native,
    );
    assert_changed(state.apply_event(running.clone()));
    let revision = state.revision();
    let application = state.apply_event(running);
    assert!(application.accepted);
    assert!(!application.changed);
    assert_eq!(state.revision(), revision);

    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnStarted,
        AgentEventOrigin::Native,
    )));
    apply_start(&mut state, "session-2");
    apply_turn_start(&mut state, "session-2", "turn-2");
    let session_revision = state.session(&session_key("session-1")).unwrap().revision;
    let revision = state.revision();
    let foreground_only = state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::TurnStarted,
        AgentEventOrigin::Native,
    ));
    assert_changed(foreground_only);
    assert_eq!(state.revision(), revision + 1);
    assert_eq!(
        state.session(&session_key("session-1")).unwrap().revision,
        session_revision
    );
    assert_eq!(
        state
            .foreground_session_id(terminal_id(), AgentKind::Codex)
            .unwrap()
            .as_str(),
        "session-1"
    );
}

#[test]
fn stable_delivery_ids_block_destructive_replay_after_restore() {
    let mut state = AgentState::with_delivery_receipt_capacity(NonZeroUsize::new(4).unwrap());
    let start = delivery(
        "start",
        vec![event(
            "session-1",
            None,
            None,
            AgentAction::SessionStarted {
                transcript_path: None,
            },
            AgentEventOrigin::Native,
        )],
    );
    let first = state.apply_delivery(start.clone());
    assert!(first.accepted && first.changed && !first.duplicate);
    apply_turn_start(&mut state, "session-1", "turn-1");
    assert_changed(state.apply_event(event(
        "session-1",
        Some("turn-1"),
        None,
        AgentAction::AttentionRequested {
            request_id: None,
            message: Some("Do not reset".into()),
        },
        AgentEventOrigin::Native,
    )));

    let replay = state.apply_delivery(start);
    assert!(replay.accepted && !replay.changed && replay.duplicate);
    assert_eq!(
        state.session(&session_key("session-1")).unwrap().phase,
        AgentActivityPhase::NeedsInput
    );

    let encoded = serde_json::to_vec(&state.snapshot()).unwrap();
    let snapshot: AgentStateSnapshot = serde_json::from_slice(&encoded).unwrap();
    let mut restored = AgentState::from_snapshot_with_delivery_receipt_capacity(
        snapshot,
        NonZeroUsize::new(4).unwrap(),
    )
    .unwrap();
    let replay = restored.apply_delivery(delivery(
        "start",
        vec![event(
            "session-1",
            None,
            None,
            AgentAction::SessionStarted {
                transcript_path: None,
            },
            AgentEventOrigin::Native,
        )],
    ));
    assert!(replay.duplicate && !replay.changed);
    assert_eq!(
        restored.session(&session_key("session-1")).unwrap().phase,
        AgentActivityPhase::NeedsInput
    );
}

#[test]
fn delivery_receipt_window_is_bounded_and_terminal_scoped() {
    let mut state = AgentState::with_delivery_receipt_capacity(NonZeroUsize::new(2).unwrap());
    for id in ["one", "two", "three"] {
        let application = state.apply_delivery(delivery(id, vec![]));
        assert!(application.accepted && !application.changed && !application.duplicate);
    }
    assert_eq!(
        state
            .snapshot()
            .delivery_receipts
            .iter()
            .map(|receipt| receipt.delivery_id.as_str())
            .collect::<Vec<_>>(),
        ["two", "three"]
    );
    assert!(state.apply_delivery(delivery("two", vec![])).duplicate);
    assert!(!state.apply_delivery(delivery("one", vec![])).duplicate);

    let mut mismatched = event(
        "session-1",
        None,
        None,
        AgentAction::SessionStarted {
            transcript_path: None,
        },
        AgentEventOrigin::Native,
    );
    mismatched.terminal_id = other_terminal_id();
    let invalid = state.apply_delivery(delivery("mismatch", vec![mismatched]));
    assert!(!invalid.accepted && !invalid.changed && !invalid.duplicate);
}

fn apply_start(state: &mut AgentState, session: &str) {
    assert_changed(state.apply_event(event(
        session,
        None,
        None,
        AgentAction::SessionStarted {
            transcript_path: None,
        },
        AgentEventOrigin::Native,
    )));
}

fn apply_turn_start(state: &mut AgentState, session: &str, turn: &str) {
    assert_changed(state.apply_event(event(
        session,
        Some(turn),
        None,
        AgentAction::TurnStarted,
        AgentEventOrigin::Native,
    )));
}

fn event(
    session: &str,
    turn: Option<&str>,
    child: Option<&str>,
    action: AgentAction,
    origin: AgentEventOrigin,
) -> AgentEvent {
    AgentEvent {
        terminal_id: terminal_id(),
        scope: AgentEventScope {
            agent: AgentKind::Codex,
            native_session_id: session_id(session),
            turn_id: turn.map(turn_id),
            child_id: child.map(child_id),
        },
        working_directory: None,
        action,
        origin,
    }
}

fn child_start(kind: AgentChildKind, nickname: Option<&str>, task: Option<&str>) -> AgentAction {
    AgentAction::ChildStarted {
        kind,
        nickname: nickname.map(str::to_owned),
        role: None,
        task: task.map(str::to_owned),
        transcript_path: None,
        usage: None,
    }
}

fn delivery(id: &str, events: Vec<AgentEvent>) -> AgentDelivery {
    AgentDelivery {
        id: AgentDeliveryId::new(id).unwrap(),
        terminal_id: terminal_id(),
        events,
    }
}

fn session_key(value: &str) -> AgentSessionKey {
    AgentSessionKey {
        terminal_id: terminal_id(),
        agent: AgentKind::Codex,
        native_session_id: session_id(value),
    }
}

fn session_id(value: &str) -> NativeSessionId {
    NativeSessionId::new(value).unwrap()
}

fn turn_id(value: &str) -> NativeTurnId {
    NativeTurnId::new(value).unwrap()
}

fn child_id(value: &str) -> NativeChildId {
    NativeChildId::new(value).unwrap()
}

fn task(id: &str, status: AgentProgressStatus) -> AgentProgressRow {
    AgentProgressRow::task(id, id, status)
}

fn goal(id: &str) -> AgentProgressRow {
    AgentProgressRow {
        id: id.into(),
        title: id.into(),
        status: AgentProgressStatus::Running,
        kind: AgentProgressKind::Goal,
    }
}

fn terminal_id() -> TerminalId {
    TerminalId::from_str("10000000-0000-4000-8000-000000000001").unwrap()
}

fn other_terminal_id() -> TerminalId {
    TerminalId::from_str("20000000-0000-4000-8000-000000000002").unwrap()
}

fn assert_changed(application: agent::AgentEventApplication) {
    assert!(application.accepted && application.changed);
}

fn assert_rejected(application: agent::AgentEventApplication) {
    assert!(!application.accepted && !application.changed);
}
