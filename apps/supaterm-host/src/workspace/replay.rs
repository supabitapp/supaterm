use crate::protocol::control::ClientId;
use crate::workspace::model::{ClientState, Workspace};
use crate::workspace::reducer::{Command, ReducerError, ReducerResult, apply};
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
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MutationEvent {
    pub epoch: Uuid,
    pub revision: u64,
    pub structure_revision: u64,
    pub workspace: Option<Workspace>,
    pub client_state: Option<ClientState>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Subscription {
    Snapshot(ModelSnapshot),
    Replay(Vec<MutationEvent>),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApplyResult {
    pub revision: u64,
    pub structure_revision: u64,
    pub reducer: ReducerResult,
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
    bytes: usize,
}

impl HostModel {
    pub fn new(
        workspace: Workspace,
        clients: Vec<ClientState>,
        replay_count_limit: usize,
        replay_byte_limit: usize,
    ) -> Self {
        Self {
            epoch: Uuid::new_v4(),
            revision: 0,
            structure_revision: 0,
            workspace,
            clients,
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
        let private_client = command.client_id();
        let changes_structure = command.changes_structure();
        let reducer = apply(&mut self.workspace, &mut self.clients, command)?;
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
        })
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
        }
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
