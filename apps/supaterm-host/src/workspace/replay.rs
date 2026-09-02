use crate::protocol::control::ClientId;
use crate::workspace::model::{ClientState, Workspace};
use crate::workspace::reducer::{Command, ReducerError, ReducerResult, apply};
use crate::workspace::runtime::{ExitFact, PaneFacts, PaneLifecycle, ProgressReport};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ModelSnapshot {
    pub epoch: Uuid,
    pub revision: u64,
    pub structure_revision: u64,
    pub workspace: Workspace,
    pub client_state: Option<ClientState>,
    pub pane_facts: BTreeMap<crate::protocol::terminal::PaneId, PaneFacts>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MutationEvent {
    pub epoch: Uuid,
    pub revision: u64,
    pub structure_revision: u64,
    pub workspace: Option<Workspace>,
    pub client_state: Option<ClientState>,
    pub pane_facts: Option<BTreeMap<crate::protocol::terminal::PaneId, PaneFacts>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Subscription {
    Snapshot(ModelSnapshot),
    Replay(Vec<MutationEvent>),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApplyResult {
    pub revision: u64,
    pub structure_revision: u64,
    pub reducer: ReducerResult,
    pub starting_pane_ids: Vec<crate::protocol::terminal::PaneId>,
    pub closing_pane_ids: Vec<crate::protocol::terminal::PaneId>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ModelError {
    #[error("stale structure revision: expected {expected}, actual {actual}")]
    StaleStructure { expected: u64, actual: u64 },
    #[error(transparent)]
    Reducer(#[from] ReducerError),
}

pub struct HostModel {
    epoch: Uuid,
    revision: u64,
    structure_revision: u64,
    workspace: Workspace,
    clients: Vec<ClientState>,
    pane_facts: BTreeMap<crate::protocol::terminal::PaneId, PaneFacts>,
    replay: VecDeque<StoredMutation>,
    replay_bytes: usize,
    replay_count_limit: usize,
    replay_byte_limit: usize,
    replay_floor: u64,
}

#[derive(Serialize)]
struct StoredMutation {
    revision: u64,
    structure_revision: u64,
    workspace: Option<Workspace>,
    clients: BTreeMap<ClientId, ClientState>,
    pane_facts: Option<BTreeMap<crate::protocol::terminal::PaneId, PaneFacts>>,
    bytes: usize,
}

impl HostModel {
    pub fn new(
        workspace: Workspace,
        clients: Vec<ClientState>,
        replay_count_limit: usize,
        replay_byte_limit: usize,
    ) -> Self {
        let pane_facts = workspace
            .pane_ids()
            .map(|pane_id| (pane_id, PaneFacts::starting(pane_id)))
            .collect();
        Self {
            epoch: Uuid::new_v4(),
            revision: 0,
            structure_revision: 0,
            workspace,
            clients,
            pane_facts,
            replay: VecDeque::new(),
            replay_bytes: 0,
            replay_count_limit: replay_count_limit.max(1),
            replay_byte_limit: replay_byte_limit.max(1),
            replay_floor: 0,
        }
    }

    pub fn with_epoch(mut self, epoch: Uuid) -> Self {
        self.epoch = epoch;
        self
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn structure_revision(&self) -> u64 {
        self.structure_revision
    }

    pub fn workspace(&self) -> &Workspace {
        &self.workspace
    }

    pub fn clients(&self) -> &[ClientState] {
        &self.clients
    }

    pub fn pane_facts(&self) -> &BTreeMap<crate::protocol::terminal::PaneId, PaneFacts> {
        &self.pane_facts
    }

    pub fn ensure_client(&mut self, client_id: ClientId) -> bool {
        if self.clients.iter().any(|client| client.id == client_id) {
            false
        } else {
            self.clients
                .push(ClientState::for_workspace(client_id, &self.workspace));
            true
        }
    }

    pub fn apply(
        &mut self,
        command: Command,
        expected_structure_revision: Option<u64>,
    ) -> Result<ApplyResult, ModelError> {
        if let Some(expected) = expected_structure_revision
            && expected != self.structure_revision
        {
            return Err(ModelError::StaleStructure {
                expected,
                actual: self.structure_revision,
            });
        }
        let before_panes: std::collections::BTreeSet<_> = self.workspace.pane_ids().collect();
        let private_client = command.client_id();
        let changes_structure = command.changes_structure();
        let reducer = apply(&mut self.workspace, &mut self.clients, command)?;
        let after_panes: std::collections::BTreeSet<_> = self.workspace.pane_ids().collect();
        let starting_pane_ids: Vec<_> = after_panes.difference(&before_panes).copied().collect();
        let closing_pane_ids: Vec<_> = before_panes.difference(&after_panes).copied().collect();
        for pane_id in &starting_pane_ids {
            self.pane_facts
                .insert(*pane_id, PaneFacts::starting(*pane_id));
        }
        for pane_id in &closing_pane_ids {
            let facts = self
                .pane_facts
                .entry(*pane_id)
                .or_insert_with(|| PaneFacts::starting(*pane_id));
            facts.lifecycle = PaneLifecycle::Closing;
        }
        self.revision = self.revision.saturating_add(1);
        if changes_structure {
            self.structure_revision = self.structure_revision.saturating_add(1);
        }
        let clients = if let Some(client_id) = private_client {
            self.clients
                .iter()
                .find(|client| client.id == client_id)
                .cloned()
                .map(|client| BTreeMap::from([(client_id, client)]))
                .unwrap_or_default()
        } else {
            self.clients
                .iter()
                .cloned()
                .map(|client| (client.id, client))
                .collect()
        };
        let mut mutation = StoredMutation {
            revision: self.revision,
            structure_revision: self.structure_revision,
            workspace: private_client.is_none().then(|| self.workspace.clone()),
            clients,
            pane_facts: (!starting_pane_ids.is_empty() || !closing_pane_ids.is_empty())
                .then(|| self.pane_facts.clone()),
            bytes: 0,
        };
        mutation.bytes = serde_json::to_vec(&mutation).map_or(0, |bytes| bytes.len());
        self.replay_bytes = self.replay_bytes.saturating_add(mutation.bytes);
        self.replay.push_back(mutation);
        self.trim_replay();
        Ok(ApplyResult {
            revision: self.revision,
            structure_revision: self.structure_revision,
            reducer,
            starting_pane_ids,
            closing_pane_ids,
        })
    }

    pub fn terminal_running(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        pid: u32,
    ) -> bool {
        let is_reachable = self
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id);
        if !is_reachable {
            return false;
        }
        let facts = self
            .pane_facts
            .entry(pane_id)
            .or_insert_with(|| PaneFacts::starting(pane_id));
        facts.lifecycle = PaneLifecycle::Running;
        facts.pid = Some(pid);
        facts.failure = None;
        facts.exit = None;
        self.record_pane_facts();
        true
    }

    pub fn terminal_failed(&mut self, pane_id: crate::protocol::terminal::PaneId, failure: String) {
        if self
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id)
        {
            let facts = self
                .pane_facts
                .entry(pane_id)
                .or_insert_with(|| PaneFacts::starting(pane_id));
            facts.lifecycle = PaneLifecycle::Failed;
            facts.pid = None;
            facts.failure = Some(failure);
        } else {
            self.pane_facts.remove(&pane_id);
        }
        self.record_pane_facts();
    }

    pub fn terminal_facts(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        title: Option<Option<String>>,
        current_directory: Option<Option<std::path::PathBuf>>,
        progress: Option<Option<ProgressReport>>,
    ) {
        let Some(facts) = self.pane_facts.get_mut(&pane_id) else {
            return;
        };
        if let Some(title) = title {
            facts.title = title;
        }
        if let Some(current_directory) = current_directory {
            facts.current_directory = current_directory;
        }
        if let Some(progress) = progress {
            facts.progress = progress;
        }
        self.record_pane_facts();
    }

    pub fn terminal_exited(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        code: Option<i32>,
        signal: Option<i32>,
    ) -> Result<(), ModelError> {
        if let Some(facts) = self.pane_facts.get_mut(&pane_id) {
            facts.lifecycle = PaneLifecycle::Closing;
            facts.exit = Some(ExitFact { code, signal });
            self.record_pane_facts();
        }
        if self
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id)
        {
            self.apply(Command::ClosePane { pane_id }, None)?;
        }
        if self.pane_facts.remove(&pane_id).is_some() {
            self.record_pane_facts();
        }
        Ok(())
    }

    pub fn subscribe(&self, client_id: ClientId, after_revision: Option<u64>) -> Subscription {
        let Some(after_revision) = after_revision else {
            return Subscription::Snapshot(self.snapshot(client_id));
        };
        if after_revision > self.revision || after_revision < self.replay_floor {
            return Subscription::Snapshot(self.snapshot(client_id));
        }
        Subscription::Replay(
            self.replay
                .iter()
                .filter(|mutation| mutation.revision > after_revision)
                .filter_map(|mutation| {
                    let client_state = mutation.clients.get(&client_id).cloned();
                    if mutation.workspace.is_none() && client_state.is_none() {
                        None
                    } else {
                        Some(MutationEvent {
                            epoch: self.epoch,
                            revision: mutation.revision,
                            structure_revision: mutation.structure_revision,
                            workspace: mutation.workspace.clone(),
                            client_state,
                            pane_facts: mutation.pane_facts.clone(),
                        })
                    }
                })
                .collect(),
        )
    }

    pub fn snapshot(&self, client_id: ClientId) -> ModelSnapshot {
        ModelSnapshot {
            epoch: self.epoch,
            revision: self.revision,
            structure_revision: self.structure_revision,
            workspace: self.workspace.clone(),
            client_state: self
                .clients
                .iter()
                .find(|client| client.id == client_id)
                .cloned(),
            pane_facts: self.pane_facts.clone(),
        }
    }

    fn record_pane_facts(&mut self) {
        self.revision = self.revision.saturating_add(1);
        let mut mutation = StoredMutation {
            revision: self.revision,
            structure_revision: self.structure_revision,
            workspace: None,
            clients: BTreeMap::new(),
            pane_facts: Some(self.pane_facts.clone()),
            bytes: 0,
        };
        mutation.bytes = serde_json::to_vec(&mutation).map_or(0, |bytes| bytes.len());
        self.replay_bytes = self.replay_bytes.saturating_add(mutation.bytes);
        self.replay.push_back(mutation);
        self.trim_replay();
    }

    fn trim_replay(&mut self) {
        while self.replay.len() > self.replay_count_limit
            || self.replay_bytes > self.replay_byte_limit
        {
            let Some(expired) = self.replay.pop_front() else {
                break;
            };
            self.replay_bytes = self.replay_bytes.saturating_sub(expired.bytes);
            self.replay_floor = expired.revision;
        }
    }
}
