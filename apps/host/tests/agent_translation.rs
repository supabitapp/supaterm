pub use supaterm_host::TerminalId;

#[path = "../src/agent/mod.rs"]
pub mod agent;

use std::{collections::BTreeSet, path::PathBuf, str::FromStr};

use agent::{
    AgentAction, AgentChildKind, AgentChildMetadata, AgentDeliveryId, AgentHook, AgentHookEvent,
    AgentKind, AgentProgressRow, AgentProgressSource, AgentProgressStatus, NativeChildId,
    translate_hook,
};
use serde_json::{Value, json};

#[test]
fn hook_contract_validates_name_and_normalizes_scope() {
    assert!(AgentHookEvent::from_value(json!({"session_id": "session"})).is_err());
    assert!(AgentHookEvent::from_value(json!([])).is_err());

    let scoped = hook(
        AgentKind::Codex,
        "scope",
        json!({
            "session_id": "  session-1\n",
            "turn_id": " turn-2 ",
            "agent_id": " child-3 ",
            "hook_event_name": "UserPromptSubmit",
            "future_field": {"kept": true}
        }),
    );
    assert_eq!(
        scoped.event.payload()["future_field"],
        json!({"kept": true})
    );
    let canonical = &translate_hook(&scoped).unwrap().events[0];
    assert_eq!(canonical.scope.native_session_id.as_str(), "session-1");
    assert_eq!(canonical.scope.turn_id.as_ref().unwrap().as_str(), "turn-2");
    assert_eq!(
        canonical.scope.child_id.as_ref().unwrap().as_str(),
        "child-3"
    );

    let unknown = hook(
        AgentKind::Codex,
        "unknown",
        json!({"session_id": "session-1", "hook_event_name": "Unknown"}),
    );
    assert!(translate_hook(&unknown).unwrap().events.is_empty());

    let missing_session = hook(
        AgentKind::Codex,
        "missing",
        json!({"session_id": "  ", "hook_event_name": "SessionStart"}),
    );
    assert!(translate_hook(&missing_session).is_none());
}

#[test]
fn provider_lifecycles_have_one_canonical_shape() {
    let claude = [
        json!({
            "session_id": "claude-1",
            "hook_event_name": "SessionStart",
            "transcript_path": "/tmp/claude.jsonl"
        }),
        json!({"session_id": "claude-1", "hook_event_name": "UserPromptSubmit"}),
        json!({
            "session_id": "claude-1",
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash"
        }),
        json!({
            "session_id": "claude-1",
            "hook_event_name": "Notification",
            "notification_type": "permission_prompt",
            "message": "Choose a path"
        }),
        json!({
            "session_id": "claude-1",
            "hook_event_name": "Stop",
            "last_assistant_message": "Done"
        }),
        json!({"session_id": "claude-1", "hook_event_name": "SessionEnd"}),
    ];
    assert_eq!(
        translated_actions(AgentKind::Claude, claude),
        vec![
            AgentAction::SessionStarted {
                transcript_path: Some(PathBuf::from("/tmp/claude.jsonl")),
            },
            AgentAction::TurnStarted,
            AgentAction::TurnRunning {
                detail: Some("Bash".into()),
            },
            AgentAction::AttentionRequested {
                request_id: None,
                message: Some("Choose a path".into()),
            },
            AgentAction::TurnCompleted {
                message: Some("Done".into()),
            },
            AgentAction::SessionEnded,
        ]
    );

    let codex = [
        json!({
            "session_id": "codex-1",
            "hook_event_name": "SessionStart",
            "transcript_path": "/tmp/codex.jsonl"
        }),
        json!({
            "session_id": "codex-1",
            "turn_id": "turn-1",
            "hook_event_name": "UserPromptSubmit"
        }),
        json!({
            "session_id": "codex-1",
            "turn_id": "turn-1",
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash"
        }),
        json!({
            "session_id": "codex-1",
            "turn_id": "turn-1",
            "hook_event_name": "Stop",
            "last_assistant_message": "Done"
        }),
        json!({"session_id": "codex-1", "hook_event_name": "SessionEnd"}),
    ];
    assert_eq!(
        translated_actions(AgentKind::Codex, codex),
        vec![
            AgentAction::SessionStarted {
                transcript_path: Some(PathBuf::from("/tmp/codex.jsonl")),
            },
            AgentAction::TurnStarted,
            AgentAction::TurnRunning {
                detail: Some("Bash".into()),
            },
            AgentAction::TurnCompleted {
                message: Some("Done".into()),
            },
            AgentAction::SessionEnded,
        ]
    );

    let pi = [
        json!({"session_id": "pi-1", "hook_event_name": "session_start"}),
        json!({"session_id": "pi-1", "hook_event_name": "agent_start"}),
        json!({
            "session_id": "pi-1",
            "hook_event_name": "agent_end",
            "message": "Done",
            "stop_reason": "stop"
        }),
        json!({"session_id": "pi-1", "hook_event_name": "session_shutdown"}),
    ];
    assert_eq!(
        translated_actions(AgentKind::Pi, pi),
        vec![
            AgentAction::SessionStarted {
                transcript_path: None,
            },
            AgentAction::TurnStarted,
            AgentAction::TurnCompleted {
                message: Some("Done".into()),
            },
            AgentAction::SessionEnded,
        ]
    );
}

#[test]
fn codex_attention_resolution_order_and_question_match_swift() {
    let permission = actions(&hook(
        AgentKind::Codex,
        "permission",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash"
        }),
    ));
    assert_eq!(
        permission,
        vec![AgentAction::AttentionRequested {
            request_id: Some("tool:Bash".into()),
            message: Some("Bash requires approval".into()),
        }]
    );

    let question = actions(&hook(
        AgentKind::Codex,
        "question",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "hook_event_name": "PreToolUse",
            "tool_name": "request_user_input",
            "tool_use_id": "call-1",
            "tool_input": {
                "questions": [
                    {"question": " \n  Which   path should I use?  "},
                    {"question": "Ignored"}
                ]
            }
        }),
    ));
    assert_eq!(
        question,
        vec![AgentAction::AttentionRequested {
            request_id: Some("id:call-1".into()),
            message: Some("Which path should I use?".into()),
        }]
    );

    let completion = actions(&hook(
        AgentKind::Codex,
        "completion",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_use_id": "call-1"
        }),
    ));
    assert_eq!(
        completion,
        vec![
            AgentAction::AttentionResolved {
                request_id: Some("id:call-1".into()),
            },
            AgentAction::AttentionResolved {
                request_id: Some("tool:Bash".into()),
            },
            AgentAction::TurnRunning {
                detail: Some("Bash".into()),
            },
        ]
    );

    let no_id = actions(&hook(
        AgentKind::Codex,
        "no-id",
        json!({
            "session_id": "session-1",
            "hook_event_name": "PostToolUse"
        }),
    ));
    assert_eq!(
        no_id,
        vec![
            AgentAction::AttentionResolved { request_id: None },
            AgentAction::TurnRunning { detail: None },
        ]
    );
}

#[test]
fn codex_plan_is_atomic_and_empty_plan_is_valid() {
    let valid = actions(&hook(
        AgentKind::Codex,
        "valid-plan",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "hook_event_name": "PostToolUse",
            "tool_name": "update_plan",
            "tool_input": {
                "plan": [
                    {"step": "Read state", "status": "completed"},
                    {"step": " Update\n panel ", "status": "in_progress"},
                    {"step": "Verify behavior", "status": "pending"}
                ]
            }
        }),
    ));
    assert_eq!(
        valid,
        vec![AgentAction::ProgressUpdated {
            rows: vec![
                AgentProgressRow::task(
                    "0:Read state",
                    "Read state",
                    AgentProgressStatus::Completed
                ),
                AgentProgressRow::task(
                    "1:Update panel",
                    "Update panel",
                    AgentProgressStatus::Running,
                ),
                AgentProgressRow::task(
                    "2:Verify behavior",
                    "Verify behavior",
                    AgentProgressStatus::Pending,
                ),
            ],
            source: AgentProgressSource::NativePlan,
        }]
    );

    let empty = actions(&hook(
        AgentKind::Codex,
        "empty-plan",
        json!({
            "session_id": "session-1",
            "hook_event_name": "PostToolUse",
            "tool_name": "update_plan",
            "tool_input": {"plan": []}
        }),
    ));
    assert_eq!(
        empty,
        vec![AgentAction::ProgressUpdated {
            rows: vec![],
            source: AgentProgressSource::NativePlan,
        }]
    );

    let invalid = actions(&hook(
        AgentKind::Codex,
        "invalid-plan",
        json!({
            "session_id": "session-1",
            "hook_event_name": "PostToolUse",
            "tool_name": "update_plan",
            "tool_input": {"plan": [{"step": "Broken", "status": "unknown"}]}
        }),
    ));
    assert_eq!(
        invalid,
        vec![
            AgentAction::AttentionResolved {
                request_id: Some("tool:update_plan".into()),
            },
            AgentAction::TurnRunning {
                detail: Some("update_plan".into()),
            },
        ]
    );
}

#[test]
fn claude_notifications_and_background_reconciliation_are_exact() {
    for notification_type in ["permission_prompt", "idle_prompt", "elicitation_dialog"] {
        assert_eq!(
            actions(&hook(
                AgentKind::Claude,
                notification_type,
                json!({
                    "session_id": "claude-1",
                    "hook_event_name": "Notification",
                    "notification_type": notification_type,
                    "message": "Choose"
                }),
            )),
            vec![AgentAction::AttentionRequested {
                request_id: None,
                message: Some("Choose".into()),
            }]
        );
    }
    for notification_type in ["agent_completed", "agent_needs_input", "auth_success"] {
        assert!(
            actions(&hook(
                AgentKind::Claude,
                notification_type,
                json!({
                    "session_id": "claude-1",
                    "hook_event_name": "Notification",
                    "notification_type": notification_type,
                    "message": "Info"
                }),
            ))
            .is_empty()
        );
    }

    let stop = actions(&hook(
        AgentKind::Claude,
        "background",
        json!({
            "session_id": "claude-1",
            "hook_event_name": "Stop",
            "last_assistant_message": "Spawned",
            "background_tasks": [
                {"id": "child-live", "type": "subagent", "status": "running"},
                {"id": "child-pending", "type": "subagent", "status": "pending"},
                {"id": "child-done", "type": "subagent", "status": "completed"},
                {"id": "team", "type": "teammate", "status": "running"},
                {"id": "workflow", "type": "workflow", "status": "pending"},
                {"id": "shell", "type": "shell", "status": "running"}
            ],
            "session_crons": []
        }),
    ));
    assert_eq!(
        stop,
        vec![
            AgentAction::ChildrenReconciled {
                live_child_ids: BTreeSet::from([
                    NativeChildId::new("child-live").unwrap(),
                    NativeChildId::new("child-pending").unwrap(),
                ]),
                has_active_teammate: true,
                has_active_workflow: true,
            },
            AgentAction::TurnContinuesInBackground,
        ]
    );

    let drained = actions(&hook(
        AgentKind::Claude,
        "drained",
        json!({
            "session_id": "claude-1",
            "hook_event_name": "Stop",
            "last_assistant_message": "Done",
            "background_tasks": [],
            "session_crons": []
        }),
    ));
    assert_eq!(
        drained,
        vec![
            AgentAction::ChildrenReconciled {
                live_child_ids: BTreeSet::new(),
                has_active_teammate: false,
                has_active_workflow: false,
            },
            AgentAction::TurnCompleted {
                message: Some("Done".into()),
            },
        ]
    );
}

#[test]
fn child_enrichment_is_injected_and_activity_stays_pure() {
    let mut start = hook(
        AgentKind::Claude,
        "child-start",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "agent_id": "child-3",
            "agent_type": "workflow-subagent",
            "hook_event_name": "SubagentStart",
            "transcript_path": "/tmp/root.jsonl"
        }),
    );
    start.child_metadata = Some(AgentChildMetadata {
        kind: AgentChildKind::Workflow,
        nickname: Some("Audit".into()),
        task: Some("Review state".into()),
        transcript_path: PathBuf::from("/tmp/child.jsonl"),
        usage: None,
    });
    assert_eq!(
        actions(&start),
        vec![AgentAction::ChildStarted {
            kind: AgentChildKind::Workflow,
            nickname: Some("Audit".into()),
            role: Some("workflow-subagent".into()),
            task: Some("Review state".into()),
            transcript_path: Some(PathBuf::from("/tmp/child.jsonl")),
            usage: None,
        }]
    );

    let activity = actions(&hook(
        AgentKind::Claude,
        "child-tool",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "agent_id": "child-3",
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": " git   -C apps/mac log --oneline "}
        }),
    ));
    assert_eq!(
        activity,
        vec![AgentAction::TurnRunning {
            detail: Some("Bash: git -C apps/mac log --oneline".into()),
        }]
    );

    let codex_default = actions(&hook(
        AgentKind::Codex,
        "codex-child",
        json!({
            "session_id": "session-1",
            "turn_id": "turn-2",
            "agent_id": "child-3",
            "agent_type": "default",
            "hook_event_name": "SubagentStart",
            "transcript_path": "/tmp/codex.jsonl"
        }),
    ));
    assert_eq!(
        codex_default,
        vec![AgentAction::ChildStarted {
            kind: AgentChildKind::Subagent,
            nickname: None,
            role: None,
            task: None,
            transcript_path: Some(PathBuf::from("/tmp/codex.jsonl")),
            usage: None,
        }]
    );
}

#[test]
fn compact_sessions_resume_and_incomplete_pi_runs_need_input() {
    assert_eq!(
        actions(&hook(
            AgentKind::Claude,
            "compact",
            json!({
                "session_id": "claude-1",
                "hook_event_name": "SessionStart",
                "source": "compact"
            }),
        )),
        vec![AgentAction::SessionResumed {
            transcript_path: None,
        }]
    );
    for reason in ["aborted", "error", "length"] {
        assert_eq!(
            actions(&hook(
                AgentKind::Pi,
                reason,
                json!({
                    "session_id": "pi-1",
                    "hook_event_name": "agent_end",
                    "stop_reason": reason,
                    "message": "Run needs attention"
                }),
            )),
            vec![AgentAction::AttentionRequested {
                request_id: None,
                message: Some("Run needs attention".into()),
            }]
        );
    }
}

fn hook(agent: AgentKind, delivery_id: &str, payload: Value) -> AgentHook {
    AgentHook {
        delivery_id: AgentDeliveryId::new(delivery_id).unwrap(),
        terminal_id: terminal_id(),
        agent,
        event: AgentHookEvent::from_value(payload).unwrap(),
        child_metadata: None,
    }
}

fn actions(hook: &AgentHook) -> Vec<AgentAction> {
    translate_hook(hook)
        .unwrap()
        .events
        .into_iter()
        .map(|event| event.action)
        .collect()
}

fn translated_actions<const N: usize>(agent: AgentKind, payloads: [Value; N]) -> Vec<AgentAction> {
    payloads
        .into_iter()
        .enumerate()
        .flat_map(|(index, payload)| actions(&hook(agent, &format!("event-{index}"), payload)))
        .collect()
}

fn terminal_id() -> TerminalId {
    TerminalId::from_str("10000000-0000-4000-8000-000000000001").unwrap()
}
