use crate::protocol::terminal::PaneId;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
        }
    }
}
