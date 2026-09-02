use crate::protocol::terminal::PaneId;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProcessTreeEntry {
    pub identity: ProcessIdentity,
    pub parent_process_id: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ListeningEndpoint {
    pub port: u16,
    pub bind_address: String,
    pub protocol: String,
    pub process_identity: ProcessIdentity,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestKind {
    Open,
    Draft,
    Merged,
    Closed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Pending,
    Passing,
    Failing,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CheckFact {
    pub name: String,
    pub state: CheckState,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestFact {
    pub kind: PullRequestKind,
    pub title: String,
    pub url: String,
    pub added_lines: u64,
    pub removed_lines: u64,
    pub checks: Vec<CheckFact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepositoryFact {
    pub root: PathBuf,
    pub branch: String,
    pub added_lines: u64,
    pub removed_lines: u64,
    pub pull_request: Option<PullRequestFact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AgentEnrichment {
    pub pane_id: PaneId,
    pub source_process: ProcessIdentity,
    pub process_tree: Vec<ProcessTreeEntry>,
    pub listening_endpoints: Vec<ListeningEndpoint>,
    pub repository: Option<RepositoryFact>,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub start_identity: String,
    pub foreground_process_group: u32,
    pub executable: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    Idle,
    Working,
    Blocked,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthority {
    Hook,
    Process,
    Osc,
    Screen,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AgentFact {
    pub pane_id: PaneId,
    pub kind: Option<String>,
    pub phase: AgentPhase,
    pub authority: AgentAuthority,
    pub process_identity: ProcessIdentity,
    pub native_session_id: Option<String>,
    pub working_directory: Option<PathBuf>,
    pub command_arguments: Option<Vec<String>>,
    pub rule_id: Option<String>,
    pub revision: u64,
    pub attention_revision: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationOrigin {
    Bell,
    Desktop,
    Agent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationRecord {
    pub id: Uuid,
    pub pane_id: PaneId,
    pub origin: NotificationOrigin,
    pub title: Option<String>,
    pub body: Option<String>,
    pub timestamp_millis: u64,
    pub attention_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneLifecycle {
    Starting,
    Running,
    Failed,
    Closing,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgressState {
    Set,
    Error,
    Indeterminate,
    Paused,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressReport {
    pub state: ProgressState,
    pub percent: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PaneFacts {
    pub pane_id: PaneId,
    pub lifecycle: PaneLifecycle,
    pub pid: Option<u32>,
    pub title: Option<String>,
    pub current_directory: Option<PathBuf>,
    pub progress: Option<ProgressReport>,
    pub failure: Option<String>,
    pub exit: Option<ExitFact>,
    pub foreground_process: Option<ProcessIdentity>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExitFact {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

impl PaneFacts {
    pub fn starting(pane_id: PaneId) -> Self {
        Self {
            pane_id,
            lifecycle: PaneLifecycle::Starting,
            pid: None,
            title: None,
            current_directory: None,
            progress: None,
            failure: None,
            exit: None,
            foreground_process: None,
        }
    }
}
