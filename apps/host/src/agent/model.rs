use std::{collections::BTreeMap, fmt, path::PathBuf, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize, de};

use crate::TerminalId;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InvalidAgentIdentifier;

impl fmt::Display for InvalidAgentIdentifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("agent identifier must not be empty")
    }
}

impl std::error::Error for InvalidAgentIdentifier {}

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, InvalidAgentIdentifier> {
                let value = value.into();
                let value = value.trim();
                if value.is_empty() {
                    return Err(InvalidAgentIdentifier);
                }
                Ok(Self(value.to_owned()))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl FromStr for $name {
            type Err = InvalidAgentIdentifier;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Self::new(value)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                Self::new(String::deserialize(deserializer)?)
                    .map_err(|error| de::Error::custom(error.to_string()))
            }
        }
    };
}

string_id!(AgentDeliveryId);
string_id!(NativeChildId);
string_id!(NativeSessionId);
string_id!(NativeTurnId);

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentKind {
    Claude,
    Codex,
    Pi,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentEventOrigin {
    Native,
    Transcript,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentProgressSource {
    NativePlan,
    Transcript,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentActivityPhase {
    Idle,
    Running,
    NeedsInput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "state", content = "turnId", rename_all = "camelCase")]
pub enum AgentTurnLifecycle {
    Unseen,
    Active(Option<NativeTurnId>),
    Completed(Option<NativeTurnId>),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentProgressStatus {
    Pending,
    Running,
    Completed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentProgressKind {
    Task,
    Goal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProgressRow {
    pub id: String,
    pub title: String,
    pub status: AgentProgressStatus,
    pub kind: AgentProgressKind,
}

impl AgentProgressRow {
    pub fn task(
        id: impl Into<String>,
        title: impl Into<String>,
        status: AgentProgressStatus,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            status,
            kind: AgentProgressKind::Task,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentChildKind {
    Subagent,
    Teammate,
    Unknown,
    Workflow,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChildUsage {
    pub model: Option<String>,
    pub context_tokens: u64,
    pub started_at_milliseconds: i64,
    pub last_active_at_milliseconds: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChildIdentity {
    pub child_id: NativeChildId,
    pub native_session_id: NativeSessionId,
    pub turn_id: Option<NativeTurnId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChild {
    pub id: AgentChildIdentity,
    pub kind: AgentChildKind,
    pub nickname: Option<String>,
    pub role: Option<String>,
    pub transcript_path: Option<PathBuf>,
    pub task: Option<String>,
    pub phase: AgentActivityPhase,
    pub detail: Option<String>,
    pub attention_request_id: Option<String>,
    pub usage: Option<AgentChildUsage>,
}

impl AgentChild {
    pub fn display_detail(&self) -> Option<&str> {
        self.detail.as_deref().or(self.task.as_deref())
    }

    pub fn runs_in_workflow(&self) -> bool {
        self.kind == AgentChildKind::Workflow
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionKey {
    pub terminal_id: TerminalId,
    pub agent: AgentKind,
    pub native_session_id: NativeSessionId,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentForegroundKey {
    pub terminal_id: TerminalId,
    pub agent: AgentKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventScope {
    pub agent: AgentKind,
    pub native_session_id: NativeSessionId,
    pub turn_id: Option<NativeTurnId>,
    pub child_id: Option<NativeChildId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentAction {
    AttentionRequested {
        request_id: Option<String>,
        message: Option<String>,
    },
    AttentionResolved {
        request_id: Option<String>,
    },
    HoverMessagesUpdated {
        messages: Vec<String>,
    },
    ProgressUpdated {
        rows: Vec<AgentProgressRow>,
        source: AgentProgressSource,
    },
    SessionEnded,
    SessionResumed {
        transcript_path: Option<PathBuf>,
    },
    SessionStarted {
        transcript_path: Option<PathBuf>,
    },
    ChildDescribed {
        kind: Option<AgentChildKind>,
        nickname: Option<String>,
        task: Option<String>,
        transcript_path: Option<PathBuf>,
        usage: Option<AgentChildUsage>,
    },
    ChildStarted {
        kind: AgentChildKind,
        nickname: Option<String>,
        role: Option<String>,
        task: Option<String>,
        transcript_path: Option<PathBuf>,
        usage: Option<AgentChildUsage>,
    },
    ChildStopped {
        usage: Option<AgentChildUsage>,
    },
    ChildrenReconciled {
        live_child_ids: std::collections::BTreeSet<NativeChildId>,
        has_active_teammate: bool,
        has_active_workflow: bool,
    },
    TurnCompleted {
        message: Option<String>,
    },
    TurnContinuesInBackground,
    TurnRunning {
        detail: Option<String>,
    },
    TurnStarted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub terminal_id: TerminalId,
    pub scope: AgentEventScope,
    pub working_directory: Option<PathBuf>,
    pub action: AgentAction,
    pub origin: AgentEventOrigin,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelivery {
    pub id: AgentDeliveryId,
    pub terminal_id: TerminalId,
    pub events: Vec<AgentEvent>,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeliveryReceipt {
    pub terminal_id: TerminalId,
    pub delivery_id: AgentDeliveryId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentEventApplication {
    pub accepted: bool,
    pub changed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentDeliveryApplication {
    pub accepted: bool,
    pub changed: bool,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    pub key: AgentSessionKey,
    pub transcript_path: Option<PathBuf>,
    pub turn_lifecycle: AgentTurnLifecycle,
    pub phase: AgentActivityPhase,
    pub detail: Option<String>,
    pub attention_request_id: Option<String>,
    pub hover_messages: Vec<String>,
    pub is_actionable: bool,
    pub progress_rows_by_source: BTreeMap<AgentProgressSource, Vec<AgentProgressRow>>,
    pub children: Vec<AgentChild>,
    pub has_pending_background_work: bool,
    pub revision: u64,
    pub working_directory: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentForegroundSession {
    pub key: AgentForegroundKey,
    pub native_session_id: NativeSessionId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateSnapshot {
    pub revision: u64,
    pub sessions: Vec<AgentSessionSnapshot>,
    pub foreground_sessions: Vec<AgentForegroundSession>,
    pub delivery_receipts: Vec<AgentDeliveryReceipt>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPresentation {
    pub key: AgentSessionKey,
    pub phase: AgentActivityPhase,
    pub detail: Option<String>,
    pub hover_messages: Vec<String>,
    pub is_actionable: bool,
    pub progress_rows: Vec<AgentProgressRow>,
    pub children: Vec<AgentChild>,
    pub turn_lifecycle: AgentTurnLifecycle,
    pub working_directory: Option<PathBuf>,
}

impl AgentPresentation {
    pub fn has_activity(&self) -> bool {
        self.turn_lifecycle != AgentTurnLifecycle::Unseen || !self.children.is_empty()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentChildMetadata {
    pub kind: AgentChildKind,
    pub nickname: Option<String>,
    pub task: Option<String>,
    pub transcript_path: PathBuf,
    pub usage: Option<AgentChildUsage>,
}
