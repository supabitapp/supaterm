use crate::agent::process::ProcessScan;
use crate::protocol::control::ClientId;
use crate::workspace::model::{ClientState, Workspace};
use crate::workspace::reducer::{Command, ReducerError, ReducerResult, apply};
use crate::workspace::runtime::{
    AgentAuthority, AgentEnrichment, AgentFact, AgentPhase, ExitFact, NotificationOrigin,
    NotificationRecord, PaneFacts, PaneLifecycle, ProcessIdentity, ProgressReport,
};
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
    pub agent_facts: BTreeMap<crate::protocol::terminal::PaneId, AgentFact>,
    pub notifications: Vec<NotificationRecord>,
    pub enrichments: BTreeMap<crate::protocol::terminal::PaneId, AgentEnrichment>,
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
    pub agent_facts: Option<BTreeMap<crate::protocol::terminal::PaneId, AgentFact>>,
    pub notifications: Option<Vec<NotificationRecord>>,
    pub enrichments: Option<BTreeMap<crate::protocol::terminal::PaneId, AgentEnrichment>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Subscription {
    Snapshot(Box<ModelSnapshot>),
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
    agent_facts: BTreeMap<crate::protocol::terminal::PaneId, AgentFact>,
    notifications: VecDeque<NotificationRecord>,
    enrichments: BTreeMap<crate::protocol::terminal::PaneId, AgentEnrichment>,
    attention_revision: u64,
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
    agent_facts: Option<BTreeMap<crate::protocol::terminal::PaneId, AgentFact>>,
    notifications: Option<Vec<NotificationRecord>>,
    enrichments: Option<BTreeMap<crate::protocol::terminal::PaneId, AgentEnrichment>>,
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
            agent_facts: BTreeMap::new(),
            notifications: VecDeque::new(),
            enrichments: BTreeMap::new(),
            attention_revision: 0,
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

    pub fn agent_facts(&self) -> &BTreeMap<crate::protocol::terminal::PaneId, AgentFact> {
        &self.agent_facts
    }

    pub fn notifications(&self) -> &VecDeque<NotificationRecord> {
        &self.notifications
    }

    pub fn enrichments(&self) -> &BTreeMap<crate::protocol::terminal::PaneId, AgentEnrichment> {
        &self.enrichments
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
            self.agent_facts.remove(pane_id);
            self.enrichments.remove(pane_id);
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
            agent_facts: (!closing_pane_ids.is_empty()).then(|| self.agent_facts.clone()),
            notifications: None,
            enrichments: (!closing_pane_ids.is_empty()).then(|| self.enrichments.clone()),
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

    pub fn reset_workspace(
        &mut self,
        workspace: Workspace,
    ) -> Vec<crate::protocol::terminal::PaneId> {
        let closing_pane_ids = self.workspace.pane_ids().collect::<Vec<_>>();
        let client_ids = self
            .clients
            .iter()
            .map(|client| client.id)
            .collect::<Vec<_>>();
        self.workspace = workspace;
        self.clients = client_ids
            .into_iter()
            .map(|client_id| ClientState::for_workspace(client_id, &self.workspace))
            .collect();
        self.pane_facts.clear();
        self.agent_facts.clear();
        self.notifications.clear();
        self.enrichments.clear();
        self.attention_revision = 0;
        self.revision = self.revision.saturating_add(1);
        self.structure_revision = self.structure_revision.saturating_add(1);
        let clients = self
            .clients
            .iter()
            .cloned()
            .map(|client| (client.id, client))
            .collect();
        let mut mutation = StoredMutation {
            revision: self.revision,
            structure_revision: self.structure_revision,
            workspace: Some(self.workspace.clone()),
            clients,
            pane_facts: Some(self.pane_facts.clone()),
            agent_facts: Some(self.agent_facts.clone()),
            notifications: Some(Vec::new()),
            enrichments: Some(self.enrichments.clone()),
            bytes: 0,
        };
        mutation.bytes = serde_json::to_vec(&mutation).map_or(0, |bytes| bytes.len());
        self.replay_bytes = self.replay_bytes.saturating_add(mutation.bytes);
        self.replay.push_back(mutation);
        self.trim_replay();
        closing_pane_ids
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

    pub fn process_scanned(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        scan: ProcessScan,
    ) {
        if !self
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id)
        {
            return;
        }
        let process_changed = self
            .pane_facts
            .get(&pane_id)
            .and_then(|facts| facts.foreground_process.as_ref())
            != Some(&scan.identity);
        if self
            .pane_facts
            .get(&pane_id)
            .and_then(|facts| facts.foreground_process.as_ref())
            == Some(&scan.identity)
        {
            return;
        }
        if let Some(facts) = self.pane_facts.get_mut(&pane_id) {
            facts.foreground_process = Some(scan.identity.clone());
        }
        if process_changed {
            self.enrichments.remove(&pane_id);
        }
        let prior_kind = self
            .agent_facts
            .get(&pane_id)
            .and_then(|fact| fact.kind.clone());
        let prior_attention_revision = self
            .agent_facts
            .get(&pane_id)
            .and_then(|fact| fact.attention_revision);
        let kind = scan.agent_kind.clone();
        let leaving_agent = prior_kind.is_some() && kind.is_none();
        let attention_revision = if leaving_agent {
            Some(self.next_attention_revision())
        } else {
            prior_attention_revision
        };
        self.agent_facts.insert(
            pane_id,
            AgentFact {
                pane_id,
                kind,
                phase: if leaving_agent {
                    AgentPhase::Idle
                } else {
                    AgentPhase::Unknown
                },
                authority: AgentAuthority::Process,
                process_identity: scan.identity,
                native_session_id: None,
                working_directory: self
                    .pane_facts
                    .get(&pane_id)
                    .and_then(|facts| facts.current_directory.clone()),
                command_arguments: (!scan.arguments.is_empty()).then_some(scan.arguments),
                rule_id: None,
                revision: self.revision.saturating_add(1),
                attention_revision,
            },
        );
        self.record_services(true, false, process_changed);
    }

    pub fn process_lost(&mut self, pane_id: crate::protocol::terminal::PaneId) {
        let had_process = self
            .pane_facts
            .get(&pane_id)
            .and_then(|facts| facts.foreground_process.as_ref())
            .is_some();
        if !had_process {
            return;
        }
        if let Some(facts) = self.pane_facts.get_mut(&pane_id) {
            facts.foreground_process = None;
        }
        let enrichment_removed = self.enrichments.remove(&pane_id).is_some();
        let attention_revision = self.next_attention_revision();
        if let Some(fact) = self.agent_facts.get_mut(&pane_id) {
            fact.phase = AgentPhase::Idle;
            fact.authority = AgentAuthority::Process;
            fact.revision = self.revision.saturating_add(1);
            fact.attention_revision = Some(attention_revision);
        }
        self.record_services(true, false, enrichment_removed);
    }

    pub fn agent_session_start(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        kind: String,
        native_session_id: String,
        working_directory: Option<std::path::PathBuf>,
        command_arguments: Option<Vec<String>>,
    ) -> bool {
        let Some(process_identity) = self
            .pane_facts
            .get(&pane_id)
            .and_then(|facts| facts.foreground_process.clone())
        else {
            return false;
        };
        let command_arguments = command_arguments.or_else(|| {
            self.agent_facts
                .get(&pane_id)
                .and_then(|fact| fact.command_arguments.clone())
        });
        self.agent_facts.insert(
            pane_id,
            AgentFact {
                pane_id,
                kind: Some(kind),
                phase: AgentPhase::Unknown,
                authority: AgentAuthority::Hook,
                process_identity,
                native_session_id: Some(native_session_id),
                working_directory,
                command_arguments,
                rule_id: None,
                revision: self.revision.saturating_add(1),
                attention_revision: None,
            },
        );
        self.record_services(true, false, false);
        true
    }

    pub fn detect_agent_phase(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        phase: AgentPhase,
        authority: AgentAuthority,
        rule_id: String,
    ) {
        let next_revision = self.revision.saturating_add(1);
        let needs_attention = self.agent_facts.get(&pane_id).is_some_and(|fact| {
            fact.phase == AgentPhase::Working
                && matches!(phase, AgentPhase::Idle | AgentPhase::Blocked)
        });
        let attention_revision = needs_attention.then(|| self.next_attention_revision());
        let Some(fact) = self.agent_facts.get_mut(&pane_id) else {
            return;
        };
        fact.phase = phase;
        fact.authority = authority;
        fact.rule_id = Some(rule_id);
        fact.revision = next_revision;
        if let Some(attention_revision) = attention_revision {
            fact.attention_revision = Some(attention_revision);
        }
        self.record_services(true, false, false);
    }

    pub fn notify(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        origin: NotificationOrigin,
        title: Option<String>,
        body: Option<String>,
        timestamp_millis: u64,
    ) {
        if !self
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id)
        {
            return;
        }
        let attention_revision = self.next_attention_revision();
        if let Some(last) = self.notifications.back_mut()
            && last.pane_id == pane_id
            && last.origin == origin
            && last.title == title
            && last.body == body
        {
            last.timestamp_millis = timestamp_millis;
            last.attention_revision = attention_revision;
        } else {
            self.notifications.push_back(NotificationRecord {
                id: Uuid::new_v4(),
                pane_id,
                origin,
                title,
                body,
                timestamp_millis,
                attention_revision,
            });
        }
        while self.notifications.len() > 512 {
            self.notifications.pop_front();
        }
        self.record_services(false, true, false);
    }

    pub fn enrichment_scanned(
        &mut self,
        pane_id: crate::protocol::terminal::PaneId,
        source_process: &ProcessIdentity,
        mut enrichment: AgentEnrichment,
    ) -> bool {
        let current = self
            .pane_facts
            .get(&pane_id)
            .and_then(|facts| facts.foreground_process.as_ref());
        if current != Some(source_process) {
            return false;
        }
        enrichment.revision = self
            .enrichments
            .get(&pane_id)
            .map_or(0, |current| current.revision);
        if self.enrichments.get(&pane_id) == Some(&enrichment) {
            return false;
        }
        enrichment.revision = self.revision.saturating_add(1);
        self.enrichments.insert(pane_id, enrichment);
        self.record_services(false, false, true);
        true
    }

    pub fn clear_enrichment(&mut self, pane_id: crate::protocol::terminal::PaneId) -> bool {
        if self.enrichments.remove(&pane_id).is_none() {
            return false;
        }
        self.record_services(false, false, true);
        true
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
            return Subscription::Snapshot(Box::new(self.snapshot(client_id)));
        };
        if after_revision > self.revision || after_revision < self.replay_floor {
            return Subscription::Snapshot(Box::new(self.snapshot(client_id)));
        }
        Subscription::Replay(
            self.replay
                .iter()
                .filter(|mutation| mutation.revision > after_revision)
                .filter_map(|mutation| {
                    let client_state = mutation.clients.get(&client_id).cloned();
                    if mutation.workspace.is_none()
                        && client_state.is_none()
                        && mutation.pane_facts.is_none()
                        && mutation.agent_facts.is_none()
                        && mutation.notifications.is_none()
                        && mutation.enrichments.is_none()
                    {
                        None
                    } else {
                        Some(MutationEvent {
                            epoch: self.epoch,
                            revision: mutation.revision,
                            structure_revision: mutation.structure_revision,
                            workspace: mutation.workspace.clone(),
                            client_state,
                            pane_facts: mutation.pane_facts.clone(),
                            agent_facts: mutation.agent_facts.clone(),
                            notifications: mutation.notifications.clone(),
                            enrichments: mutation.enrichments.clone(),
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
            agent_facts: self.agent_facts.clone(),
            notifications: self.notifications.iter().cloned().collect(),
            enrichments: self.enrichments.clone(),
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
            agent_facts: None,
            notifications: None,
            enrichments: None,
            bytes: 0,
        };
        mutation.bytes = serde_json::to_vec(&mutation).map_or(0, |bytes| bytes.len());
        self.replay_bytes = self.replay_bytes.saturating_add(mutation.bytes);
        self.replay.push_back(mutation);
        self.trim_replay();
    }

    fn record_services(&mut self, agents: bool, notifications: bool, enrichments: bool) {
        self.revision = self.revision.saturating_add(1);
        let mut mutation = StoredMutation {
            revision: self.revision,
            structure_revision: self.structure_revision,
            workspace: None,
            clients: BTreeMap::new(),
            pane_facts: agents.then(|| self.pane_facts.clone()),
            agent_facts: agents.then(|| self.agent_facts.clone()),
            notifications: notifications.then(|| self.notifications.iter().cloned().collect()),
            enrichments: enrichments.then(|| self.enrichments.clone()),
            bytes: 0,
        };
        mutation.bytes = serde_json::to_vec(&mutation).map_or(0, |bytes| bytes.len());
        self.replay_bytes = self.replay_bytes.saturating_add(mutation.bytes);
        self.replay.push_back(mutation);
        self.trim_replay();
    }

    fn next_attention_revision(&mut self) -> u64 {
        self.attention_revision = self.attention_revision.saturating_add(1);
        self.attention_revision
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
