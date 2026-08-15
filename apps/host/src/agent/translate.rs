use std::{fmt, path::PathBuf};

use serde::{Deserialize, Deserializer, Serialize, de};
use serde_json::{Map, Value};

use super::{
    AgentAction, AgentChildKind, AgentChildMetadata, AgentDelivery, AgentDeliveryId, AgentEvent,
    AgentEventOrigin, AgentEventScope, AgentKind, AgentProgressRow, AgentProgressSource,
    AgentProgressStatus, NativeChildId, NativeSessionId, NativeTurnId,
};
use crate::TerminalId;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InvalidAgentHookEvent;

impl fmt::Display for InvalidAgentHookEvent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("agent hook event must contain a string hook_event_name")
    }
}

impl std::error::Error for InvalidAgentHookEvent {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct AgentHookEvent(Map<String, Value>);

impl AgentHookEvent {
    pub fn new(payload: Map<String, Value>) -> Result<Self, InvalidAgentHookEvent> {
        match payload.get("hook_event_name") {
            Some(Value::String(_)) => Ok(Self(payload)),
            _ => Err(InvalidAgentHookEvent),
        }
    }

    pub fn from_value(value: Value) -> Result<Self, InvalidAgentHookEvent> {
        match value {
            Value::Object(payload) => Self::new(payload),
            _ => Err(InvalidAgentHookEvent),
        }
    }

    pub fn payload(&self) -> &Map<String, Value> {
        &self.0
    }

    fn value(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }

    fn string(&self, key: &str) -> Option<&str> {
        normalized(self.value(key)?.as_str()?)
    }

    fn name(&self) -> &str {
        self.value("hook_event_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }
}

impl<'de> Deserialize<'de> for AgentHookEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(Map::<String, Value>::deserialize(deserializer)?)
            .map_err(|error| de::Error::custom(error.to_string()))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentHook {
    pub delivery_id: AgentDeliveryId,
    pub terminal_id: TerminalId,
    pub agent: AgentKind,
    pub event: AgentHookEvent,
    pub child_metadata: Option<AgentChildMetadata>,
}

pub fn translate_hook(hook: &AgentHook) -> Option<AgentDelivery> {
    let native_session_id = NativeSessionId::new(hook.event.string("session_id")?).ok()?;
    let scope = AgentEventScope {
        agent: hook.agent,
        native_session_id,
        turn_id: hook
            .event
            .string("turn_id")
            .and_then(|value| NativeTurnId::new(value).ok()),
        child_id: hook
            .event
            .string("agent_id")
            .and_then(|value| NativeChildId::new(value).ok()),
    };
    let events = if scope.child_id.is_some() {
        match hook.event.name() {
            "SubagentStart" => vec![canonical_event(hook, scope, child_started_action(hook))],
            "SubagentStop" => vec![canonical_event(
                hook,
                scope,
                AgentAction::ChildStopped {
                    usage: (hook.agent != AgentKind::Codex)
                        .then(|| hook.child_metadata.as_ref()?.usage.clone())
                        .flatten(),
                },
            )],
            _ => translated_agent_events(hook, scope),
        }
    } else {
        translated_agent_events(hook, scope)
    };
    Some(AgentDelivery {
        id: hook.delivery_id.clone(),
        terminal_id: hook.terminal_id,
        events,
    })
}

fn translated_agent_events(hook: &AgentHook, scope: AgentEventScope) -> Vec<AgentEvent> {
    match hook.agent {
        AgentKind::Claude => claude_events(hook, scope),
        AgentKind::Codex => codex_events(hook, scope),
        AgentKind::Pi => pi_events(hook, scope),
    }
}

fn child_started_action(hook: &AgentHook) -> AgentAction {
    let role = hook.event.string("agent_type").and_then(normalize_words);
    if hook.agent == AgentKind::Codex {
        return AgentAction::ChildStarted {
            kind: AgentChildKind::Subagent,
            nickname: hook
                .child_metadata
                .as_ref()
                .and_then(|metadata| metadata.nickname.clone()),
            role: role.filter(|value| !value.eq_ignore_ascii_case("default")),
            task: None,
            transcript_path: hook.event.string("transcript_path").map(PathBuf::from),
            usage: None,
        };
    }
    let metadata = hook.child_metadata.as_ref();
    AgentAction::ChildStarted {
        kind: metadata.map_or_else(
            || {
                if role
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case("workflow-subagent"))
                {
                    AgentChildKind::Workflow
                } else {
                    AgentChildKind::Unknown
                }
            },
            |metadata| metadata.kind,
        ),
        nickname: metadata.and_then(|metadata| metadata.nickname.clone()),
        role,
        task: metadata.and_then(|metadata| metadata.task.clone()),
        transcript_path: metadata.map(|metadata| metadata.transcript_path.clone()),
        usage: metadata.and_then(|metadata| metadata.usage.clone()),
    }
}

fn claude_events(hook: &AgentHook, scope: AgentEventScope) -> Vec<AgentEvent> {
    let action = match hook.event.name() {
        "Notification" => {
            if !matches!(
                hook.event.string("notification_type"),
                Some("elicitation_dialog" | "idle_prompt" | "permission_prompt")
            ) {
                return Vec::new();
            }
            AgentAction::AttentionRequested {
                request_id: attention_request_id(hook),
                message: hook.event.string("message").map(str::to_owned),
            }
        }
        "PostToolUse" => {
            let mut events = attention_resolution_events(hook, &scope);
            if scope.child_id.is_some() {
                events.extend(child_description_events(hook, &scope));
                events.extend(child_activity_events(hook, &scope));
                return events;
            }
            events.push(canonical_event(
                hook,
                scope,
                AgentAction::TurnRunning {
                    detail: hook.event.string("tool_name").map(str::to_owned),
                },
            ));
            return events;
        }
        "PreToolUse" if scope.child_id.is_some() => {
            let mut events = child_description_events(hook, &scope);
            events.extend(child_activity_events(hook, &scope));
            return events;
        }
        "PreToolUse" => AgentAction::TurnRunning {
            detail: hook.event.string("tool_name").map(str::to_owned),
        },
        "SessionEnd" => AgentAction::SessionEnded,
        "SessionStart" => session_action(hook),
        "Stop" => return claude_stop_events(hook, scope),
        "UserPromptSubmit" => AgentAction::TurnStarted,
        _ => return Vec::new(),
    };
    vec![canonical_event(hook, scope, action)]
}

fn claude_stop_events(hook: &AgentHook, scope: AgentEventScope) -> Vec<AgentEvent> {
    let stop_action = if has_active_claude_background_work(&hook.event) {
        AgentAction::TurnContinuesInBackground
    } else {
        AgentAction::TurnCompleted {
            message: hook
                .event
                .string("last_assistant_message")
                .map(str::to_owned),
        }
    };
    let Some(tasks) = hook
        .event
        .value("background_tasks")
        .and_then(Value::as_array)
    else {
        return vec![canonical_event(hook, scope, stop_action)];
    };
    if scope.child_id.is_some() {
        return vec![canonical_event(hook, scope, stop_action)];
    }
    let live_child_ids = active_claude_tasks(tasks, "subagent")
        .filter_map(|task| task.get("id").and_then(Value::as_str))
        .filter_map(|value| NativeChildId::new(value).ok())
        .collect();
    vec![
        canonical_event(
            hook,
            scope.clone(),
            AgentAction::ChildrenReconciled {
                live_child_ids,
                has_active_teammate: active_claude_tasks(tasks, "teammate").next().is_some(),
                has_active_workflow: active_claude_tasks(tasks, "workflow").next().is_some(),
            },
        ),
        canonical_event(hook, scope, stop_action),
    ]
}

fn active_claude_tasks<'a>(
    tasks: &'a [Value],
    task_type: &'a str,
) -> impl Iterator<Item = &'a Map<String, Value>> {
    tasks.iter().filter_map(move |task| {
        let task = task.as_object()?;
        let status = task.get("status")?.as_str()?;
        (task.get("type")?.as_str()? == task_type && matches!(status, "running" | "pending"))
            .then_some(task)
    })
}

fn has_active_claude_background_work(event: &AgentHookEvent) -> bool {
    if event
        .value("session_crons")
        .and_then(Value::as_array)
        .is_some_and(|crons| !crons.is_empty())
    {
        return true;
    }
    event
        .value("background_tasks")
        .and_then(Value::as_array)
        .is_some_and(|tasks| {
            tasks.iter().any(|task| {
                task.as_object()
                    .and_then(|task| task.get("status"))
                    .and_then(Value::as_str)
                    .is_some_and(|status| matches!(status, "running" | "pending"))
            })
        })
}

fn child_description_events(hook: &AgentHook, scope: &AgentEventScope) -> Vec<AgentEvent> {
    let Some(metadata) = hook.child_metadata.as_ref() else {
        return Vec::new();
    };
    vec![canonical_event(
        hook,
        scope.clone(),
        AgentAction::ChildDescribed {
            kind: Some(metadata.kind),
            nickname: metadata.nickname.clone(),
            task: metadata.task.clone(),
            transcript_path: Some(metadata.transcript_path.clone()),
            usage: metadata.usage.clone(),
        },
    )]
}

fn child_activity_events(hook: &AgentHook, scope: &AgentEventScope) -> Vec<AgentEvent> {
    tool_activity_detail(
        hook.event.string("tool_name"),
        hook.event.value("tool_input"),
    )
    .map(|detail| {
        vec![canonical_event(
            hook,
            scope.clone(),
            AgentAction::TurnRunning {
                detail: Some(detail),
            },
        )]
    })
    .unwrap_or_default()
}

fn codex_events(hook: &AgentHook, scope: AgentEventScope) -> Vec<AgentEvent> {
    if hook.event.name() == "PermissionRequest" {
        return vec![canonical_event(
            hook,
            scope,
            AgentAction::AttentionRequested {
                request_id: attention_request_id(hook),
                message: hook
                    .event
                    .string("tool_name")
                    .map(|tool| format!("{tool} requires approval")),
            },
        )];
    }
    if hook.event.name() == "PreToolUse"
        && hook.event.string("tool_name") == Some("request_user_input")
    {
        return vec![canonical_event(
            hook,
            scope,
            AgentAction::AttentionRequested {
                request_id: attention_request_id(hook),
                message: user_question(hook.event.value("tool_input")),
            },
        )];
    }
    if hook.event.name() == "PostToolUse"
        && hook.event.string("tool_name") == Some("request_user_input")
    {
        return attention_resolution_events(hook, &scope);
    }
    if hook.event.name() == "PostToolUse"
        && hook.event.string("tool_name") == Some("update_plan")
        && let Some(rows) = codex_plan_rows(hook.event.value("tool_input"))
    {
        return vec![canonical_event(
            hook,
            scope,
            AgentAction::ProgressUpdated {
                rows,
                source: AgentProgressSource::NativePlan,
            },
        )];
    }
    if hook.event.name() == "PostToolUse" {
        let mut events = attention_resolution_events(hook, &scope);
        if scope.child_id.is_none() {
            events.push(canonical_event(
                hook,
                scope,
                AgentAction::TurnRunning {
                    detail: hook.event.string("tool_name").map(str::to_owned),
                },
            ));
        }
        return events;
    }
    let action = match hook.event.name() {
        "Notification" => AgentAction::AttentionRequested {
            request_id: attention_request_id(hook),
            message: hook.event.string("message").map(str::to_owned),
        },
        "PreToolUse" if scope.child_id.is_some() => return Vec::new(),
        "PreToolUse" => AgentAction::TurnRunning {
            detail: hook.event.string("tool_name").map(str::to_owned),
        },
        "SessionEnd" => AgentAction::SessionEnded,
        "SessionStart" => session_action(hook),
        "Stop" => AgentAction::TurnCompleted {
            message: hook
                .event
                .string("last_assistant_message")
                .map(str::to_owned),
        },
        "UserPromptSubmit" => AgentAction::TurnStarted,
        _ => return Vec::new(),
    };
    vec![canonical_event(hook, scope, action)]
}

fn pi_events(hook: &AgentHook, scope: AgentEventScope) -> Vec<AgentEvent> {
    let action = match hook.event.name() {
        "session_start" => session_action(hook),
        "agent_start" => AgentAction::TurnStarted,
        "agent_end"
            if matches!(
                hook.event.string("stop_reason"),
                Some("aborted" | "error" | "length")
            ) =>
        {
            AgentAction::AttentionRequested {
                request_id: None,
                message: hook.event.string("message").map(str::to_owned),
            }
        }
        "agent_end" => AgentAction::TurnCompleted {
            message: hook.event.string("message").map(str::to_owned),
        },
        "session_shutdown" => AgentAction::SessionEnded,
        _ => return Vec::new(),
    };
    vec![canonical_event(hook, scope, action)]
}

fn session_action(hook: &AgentHook) -> AgentAction {
    let transcript_path = hook.event.string("transcript_path").map(PathBuf::from);
    if hook.event.string("source") == Some("compact") {
        AgentAction::SessionResumed { transcript_path }
    } else {
        AgentAction::SessionStarted { transcript_path }
    }
}

fn attention_request_id(hook: &AgentHook) -> Option<String> {
    hook.event
        .string("tool_use_id")
        .map(|id| format!("id:{id}"))
        .or_else(|| {
            hook.event
                .string("tool_name")
                .map(|tool| format!("tool:{tool}"))
        })
}

fn attention_resolution_events(hook: &AgentHook, scope: &AgentEventScope) -> Vec<AgentEvent> {
    let request_ids: Vec<_> = [
        hook.event
            .string("tool_use_id")
            .map(|id| format!("id:{id}")),
        hook.event
            .string("tool_name")
            .map(|tool| format!("tool:{tool}")),
    ]
    .into_iter()
    .flatten()
    .collect();
    if request_ids.is_empty() {
        return vec![canonical_event(
            hook,
            scope.clone(),
            AgentAction::AttentionResolved { request_id: None },
        )];
    }
    request_ids
        .into_iter()
        .map(|request_id| {
            canonical_event(
                hook,
                scope.clone(),
                AgentAction::AttentionResolved {
                    request_id: Some(request_id),
                },
            )
        })
        .collect()
}

fn canonical_event(hook: &AgentHook, scope: AgentEventScope, action: AgentAction) -> AgentEvent {
    AgentEvent {
        terminal_id: hook.terminal_id,
        scope,
        working_directory: hook.event.string("cwd").map(PathBuf::from),
        action,
        origin: AgentEventOrigin::Native,
    }
}

fn codex_plan_rows(input: Option<&Value>) -> Option<Vec<AgentProgressRow>> {
    let plan = input?.as_object()?.get("plan")?.as_array()?;
    plan.iter()
        .enumerate()
        .map(|(index, value)| {
            let item = value.as_object()?;
            let title = normalize_words(item.get("step")?.as_str()?)?;
            let status = match item.get("status")?.as_str()? {
                "completed" => AgentProgressStatus::Completed,
                "in_progress" => AgentProgressStatus::Running,
                "pending" => AgentProgressStatus::Pending,
                _ => return None,
            };
            Some(AgentProgressRow::task(
                format!("{index}:{title}"),
                title,
                status,
            ))
        })
        .collect()
}

fn user_question(input: Option<&Value>) -> Option<String> {
    input?
        .as_object()?
        .get("questions")?
        .as_array()?
        .iter()
        .filter_map(Value::as_object)
        .find_map(|question| {
            question
                .get("question")
                .and_then(Value::as_str)
                .and_then(normalize_words)
        })
}

fn tool_activity_detail(tool_name: Option<&str>, input: Option<&Value>) -> Option<String> {
    let tool_name = tool_name?;
    let subject = tool_subject(input);
    Some(match subject {
        Some(subject) => format!("{tool_name}: {subject}"),
        None => tool_name.to_owned(),
    })
}

fn tool_subject(input: Option<&Value>) -> Option<String> {
    let input = input?.as_object()?;
    for key in [
        "command",
        "file_path",
        "pattern",
        "query",
        "url",
        "description",
        "prompt",
        "skill",
    ] {
        let Some(mut subject) = input
            .get(key)
            .and_then(Value::as_str)
            .and_then(normalize_words)
        else {
            continue;
        };
        if key == "file_path"
            && let Some(file_name) = PathBuf::from(&subject).file_name()
        {
            subject = file_name.to_string_lossy().into_owned();
        }
        if subject.chars().count() > 120 {
            subject = subject.chars().take(120).collect::<String>() + "…";
        }
        return Some(subject);
    }
    None
}

fn normalized(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

fn normalize_words(value: &str) -> Option<String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!value.is_empty()).then_some(value)
}
