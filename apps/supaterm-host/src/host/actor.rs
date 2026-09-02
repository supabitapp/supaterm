use crate::protocol::control::{
    BuildIdentity, ClientId, ClientRole, CommandId, HostControl, HostId, ProtocolError,
    ProtocolErrorCode,
};
use crate::protocol::terminal::PaneId;
use crate::terminal::actor::{PaneInfo, TerminalError, TerminalRegistry, TerminalRuntimeEvent};
use crate::terminal::pty::{SpawnSpec, TerminalEnvironment};
use crate::workspace::model::{SpaceId, WindowId, Workspace};
use crate::workspace::persistence::{DurableDocument, PersistenceWorker};
use crate::workspace::reducer::{Command, ReducerError, closing_pane_ids};
use crate::workspace::replay::{HostModel, ModelError};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, VecDeque};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

const ACTOR_QUEUE_CAPACITY: usize = 256;

#[derive(Clone, Debug)]
pub struct HostConfiguration {
    pub host_id: HostId,
    pub epoch: Uuid,
    pub build: BuildIdentity,
    pub capabilities: Vec<String>,
    pub command_cache_capacity: usize,
    pub terminal_environment: Option<TerminalEnvironment>,
}

#[derive(Clone, Debug)]
pub struct HostStatus {
    pub host_id: HostId,
    pub epoch: Uuid,
    pub build: BuildIdentity,
    pub revision: u64,
    pub structure_revision: u64,
    pub capabilities: Vec<String>,
}

#[derive(Clone)]
pub struct HostActor {
    sender: mpsc::Sender<ActorMessage>,
    terminals: TerminalRegistry,
}

impl HostActor {
    pub fn spawn(configuration: HostConfiguration) -> Self {
        let workspace = Workspace::new(
            SpaceId(Uuid::from_u128(1)),
            WindowId(Uuid::from_u128(2)),
            "Space 1".into(),
        );
        let document = DurableDocument::new(configuration.host_id, workspace, Vec::new());
        Self::spawn_with_document(configuration, document, None)
    }

    pub fn spawn_with_document(
        configuration: HostConfiguration,
        document: DurableDocument,
        persistence: Option<PersistenceWorker>,
    ) -> Self {
        let (sender, receiver) = mpsc::channel(ACTOR_QUEUE_CAPACITY);
        let (terminals, mut terminal_events) =
            TerminalRegistry::spawn_with_events(configuration.terminal_environment.clone());
        let event_sender = sender.clone();
        tokio::spawn(async move {
            while let Some(event) = terminal_events.recv().await {
                if event_sender
                    .send(ActorMessage::TerminalEvent(event))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        let model = HostModel::new(document.workspace, document.clients, 2048, 16 * 1024 * 1024)
            .with_epoch(configuration.epoch);
        tokio::spawn(run(
            configuration,
            terminals.clone(),
            sender.clone(),
            model,
            document.settings,
            persistence,
            receiver,
        ));
        Self { sender, terminals }
    }

    pub(crate) fn terminals(&self) -> &TerminalRegistry {
        &self.terminals
    }

    pub async fn status(&self) -> Result<HostStatus, ProtocolError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ActorMessage::Status { reply })
            .await
            .map_err(|_| internal_error())?;
        response.await.map_err(|_| internal_error())
    }

    pub async fn ensure_client(&self, client_id: ClientId) -> Result<(), ProtocolError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ActorMessage::EnsureClient { client_id, reply })
            .await
            .map_err(|_| internal_error())?;
        response.await.map_err(|_| internal_error())
    }

    pub async fn restore_terminal(
        &self,
        pane_id: PaneId,
        spec: SpawnSpec,
    ) -> Result<(), TerminalError> {
        match self.terminals.create_with_id(pane_id, spec).await {
            Ok(info) => self
                .sender
                .send(ActorMessage::SpawnFinished {
                    pane_id,
                    result: Ok(info),
                })
                .await
                .map_err(|_| TerminalError::Stopped),
            Err(error) => {
                let _ = self
                    .sender
                    .send(ActorMessage::SpawnFinished {
                        pane_id,
                        result: Err(error.to_string()),
                    })
                    .await;
                Err(error)
            }
        }
    }

    pub async fn execute(
        &self,
        client_id: ClientId,
        role: ClientRole,
        command_id: CommandId,
        method: String,
        params: Value,
    ) -> HostControl {
        let (reply, response) = oneshot::channel();
        if self
            .sender
            .send(ActorMessage::Execute {
                client_id,
                role,
                command_id,
                method,
                params,
                reply,
            })
            .await
            .is_err()
        {
            return HostControl::Error {
                command_id: Some(command_id),
                error: internal_error(),
            };
        }
        response.await.unwrap_or_else(|_| HostControl::Error {
            command_id: Some(command_id),
            error: internal_error(),
        })
    }
}

enum ActorMessage {
    Status {
        reply: oneshot::Sender<HostStatus>,
    },
    EnsureClient {
        client_id: ClientId,
        reply: oneshot::Sender<()>,
    },
    Execute {
        client_id: ClientId,
        role: ClientRole,
        command_id: CommandId,
        method: String,
        params: Value,
        reply: oneshot::Sender<HostControl>,
    },
    SpawnFinished {
        pane_id: PaneId,
        result: Result<PaneInfo, String>,
    },
    TerminalEvent(TerminalRuntimeEvent),
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct CommandKey {
    client_id: ClientId,
    command_id: CommandId,
}

struct ActorState {
    configuration: HostConfiguration,
    terminals: TerminalRegistry,
    sender: mpsc::Sender<ActorMessage>,
    model: HostModel,
    settings: BTreeMap<String, Value>,
    persistence: Option<PersistenceWorker>,
    command_results: HashMap<CommandKey, HostControl>,
    command_order: VecDeque<CommandKey>,
    close_grants: BTreeMap<PaneId, CloseGrant>,
}

async fn run(
    configuration: HostConfiguration,
    terminals: TerminalRegistry,
    sender: mpsc::Sender<ActorMessage>,
    model: HostModel,
    settings: BTreeMap<String, Value>,
    persistence: Option<PersistenceWorker>,
    mut receiver: mpsc::Receiver<ActorMessage>,
) {
    let mut state = ActorState {
        configuration,
        terminals,
        sender,
        model,
        settings,
        persistence,
        command_results: HashMap::new(),
        command_order: VecDeque::new(),
        close_grants: BTreeMap::new(),
    };
    while let Some(message) = receiver.recv().await {
        match message {
            ActorMessage::Status { reply } => {
                let _ = reply.send(state.status());
            }
            ActorMessage::EnsureClient { client_id, reply } => {
                if state.model.ensure_client(client_id) {
                    state.persist().await;
                }
                let _ = reply.send(());
            }
            ActorMessage::Execute {
                client_id,
                role,
                command_id,
                method,
                params,
                reply,
            } => {
                let result = state
                    .execute(client_id, role, command_id, method, params)
                    .await;
                let _ = reply.send(result);
            }
            ActorMessage::SpawnFinished { pane_id, result } => {
                state.spawn_finished(pane_id, result).await;
            }
            ActorMessage::TerminalEvent(event) => {
                state.terminal_event(event).await;
            }
        }
    }
}

impl ActorState {
    fn status(&self) -> HostStatus {
        HostStatus {
            host_id: self.configuration.host_id,
            epoch: self.configuration.epoch,
            build: self.configuration.build.clone(),
            revision: self.model.revision(),
            structure_revision: self.model.structure_revision(),
            capabilities: self.configuration.capabilities.clone(),
        }
    }

    async fn execute(
        &mut self,
        client_id: ClientId,
        role: ClientRole,
        command_id: CommandId,
        method: String,
        params: Value,
    ) -> HostControl {
        let key = CommandKey {
            client_id,
            command_id,
        };
        if let Some(result) = self.command_results.get(&key) {
            return result.clone();
        }
        let result = if role == ClientRole::Hook {
            error(
                Some(command_id),
                ProtocolErrorCode::PermissionDenied,
                json!({"method": method}),
            )
        } else {
            match method.as_str() {
                "state.snapshot" if params.is_null() => {
                    result(command_id, self.model.snapshot(client_id))
                }
                "state.snapshot" => error(
                    Some(command_id),
                    ProtocolErrorCode::InvalidRequest,
                    json!({"method": method}),
                ),
                "state.subscribe" => match serde_json::from_value::<SubscribeRequest>(params) {
                    Ok(request) => result(
                        command_id,
                        self.model.subscribe(client_id, request.after_revision),
                    ),
                    Err(decode_error) => invalid_request(command_id, decode_error),
                },
                "workspace.apply" => match serde_json::from_value::<ApplyRequest>(params) {
                    Ok(request)
                        if request
                            .command
                            .client_id()
                            .is_some_and(|target| target != client_id) =>
                    {
                        error(
                            Some(command_id),
                            ProtocolErrorCode::PermissionDenied,
                            Value::Null,
                        )
                    }
                    Ok(request) => match self.apply_workspace(request).await {
                        Ok(applied) => result(command_id, applied),
                        Err(ApplyWorkspaceError::Model(model_error)) => {
                            workspace_error(command_id, model_error)
                        }
                        Err(ApplyWorkspaceError::SpawnSpecs) => error(
                            Some(command_id),
                            ProtocolErrorCode::InvalidRequest,
                            json!({"reason": "spawn specs do not match created panes"}),
                        ),
                        Err(ApplyWorkspaceError::ConfirmationRequired(pane_ids)) => error(
                            Some(command_id),
                            ProtocolErrorCode::ConfirmationRequired,
                            json!({
                                "pane_ids": pane_ids,
                                "structure_revision": self.model.structure_revision()
                            }),
                        ),
                    },
                    Err(decode_error) => invalid_request(command_id, decode_error),
                },
                "workspace.prepare_close" => {
                    match serde_json::from_value::<PrepareCloseRequest>(params) {
                        Ok(request) => match self.prepare_close(&request.command) {
                            Ok(confirmation) => result(command_id, confirmation),
                            Err(model_error) => workspace_error(command_id, model_error),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "terminal.list" if params.is_null() => match self.terminals.list().await {
                    Ok(panes) => result(command_id, panes),
                    Err(error) => terminal_error(command_id, error),
                },
                "terminal.close" => match serde_json::from_value::<PaneRequest>(params) {
                    Ok(request) => match self
                        .apply_workspace(ApplyRequest {
                            command: Command::ClosePane {
                                pane_id: request.pane_id,
                            },
                            expected_structure_revision: None,
                            spawn_specs: BTreeMap::new(),
                            confirmation_tokens: request
                                .confirmation_token
                                .map(|token| BTreeMap::from([(request.pane_id, token)]))
                                .unwrap_or_default(),
                        })
                        .await
                    {
                        Ok(applied) => result(command_id, applied),
                        Err(ApplyWorkspaceError::Model(model_error)) => {
                            workspace_error(command_id, model_error)
                        }
                        Err(ApplyWorkspaceError::SpawnSpecs) => {
                            error(Some(command_id), ProtocolErrorCode::Internal, Value::Null)
                        }
                        Err(ApplyWorkspaceError::ConfirmationRequired(pane_ids)) => error(
                            Some(command_id),
                            ProtocolErrorCode::ConfirmationRequired,
                            json!({
                                "pane_ids": pane_ids,
                                "structure_revision": self.model.structure_revision()
                            }),
                        ),
                    },
                    Err(decode_error) => error(
                        Some(command_id),
                        ProtocolErrorCode::InvalidRequest,
                        json!({"reason": decode_error.to_string()}),
                    ),
                },
                _ => error(
                    Some(command_id),
                    ProtocolErrorCode::MethodNotFound,
                    json!({"method": method}),
                ),
            }
        };
        self.remember(key, result.clone());
        result
    }

    fn remember(&mut self, key: CommandKey, result: HostControl) {
        let capacity = self.configuration.command_cache_capacity.max(1);
        while self.command_order.len() >= capacity {
            if let Some(expired) = self.command_order.pop_front() {
                self.command_results.remove(&expired);
            }
        }
        self.command_order.push_back(key);
        self.command_results.insert(key, result);
    }

    async fn persist(&self) {
        if let Some(persistence) = &self.persistence {
            let mut document = DurableDocument::new(
                self.configuration.host_id,
                self.model.workspace().clone(),
                self.model.clients().to_vec(),
            );
            document.settings = self.settings.clone();
            let _ = persistence.save(document).await;
        }
    }

    async fn apply_workspace(
        &mut self,
        mut request: ApplyRequest,
    ) -> Result<crate::workspace::replay::ApplyResult, ApplyWorkspaceError> {
        let expected: std::collections::BTreeSet<_> =
            request.command.created_pane_id().into_iter().collect();
        if request
            .spawn_specs
            .keys()
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            != expected
        {
            return Err(ApplyWorkspaceError::SpawnSpecs);
        }
        let closing =
            closing_pane_ids(self.model.workspace(), &request.command).map_err(ModelError::from)?;
        let required: Vec<_> = closing
            .iter()
            .filter(|pane_id| {
                self.model
                    .pane_facts()
                    .get(pane_id)
                    .and_then(|facts| facts.pid)
                    .is_some()
            })
            .copied()
            .collect();
        let invalid: Vec<_> = required
            .iter()
            .filter(|pane_id| {
                let token = request.confirmation_tokens.get(pane_id);
                let pid = self.model.pane_facts()[pane_id].pid;
                !self.close_grants.get(pane_id).is_some_and(|grant| {
                    Some(&grant.token) == token
                        && grant.structure_revision == self.model.structure_revision()
                        && grant.pid == pid
                })
            })
            .copied()
            .collect();
        if !invalid.is_empty() {
            return Err(ApplyWorkspaceError::ConfirmationRequired(invalid));
        }
        let applied = self
            .model
            .apply(request.command, request.expected_structure_revision)?;
        for pane_id in required {
            self.close_grants.remove(&pane_id);
        }
        let structure_revision = self.model.structure_revision();
        self.close_grants
            .retain(|_, grant| grant.structure_revision == structure_revision);
        for pane_id in &applied.starting_pane_ids {
            let spec = request
                .spawn_specs
                .remove(pane_id)
                .ok_or(ApplyWorkspaceError::SpawnSpecs)?;
            self.schedule_spawn(*pane_id, spec);
        }
        for pane_id in &applied.closing_pane_ids {
            let terminals = self.terminals.clone();
            let pane_id = *pane_id;
            tokio::spawn(async move {
                let _ = terminals.close(pane_id).await;
            });
        }
        self.persist().await;
        Ok(applied)
    }

    fn prepare_close(&mut self, command: &Command) -> Result<CloseConfirmation, ModelError> {
        let pane_ids = closing_pane_ids(self.model.workspace(), command)?;
        let structure_revision = self.model.structure_revision();
        let mut processes = BTreeMap::new();
        let mut tokens = BTreeMap::new();
        for pane_id in pane_ids {
            let Some(pid) = self
                .model
                .pane_facts()
                .get(&pane_id)
                .and_then(|facts| facts.pid)
            else {
                continue;
            };
            let token = Uuid::new_v4();
            self.close_grants.insert(
                pane_id,
                CloseGrant {
                    token,
                    structure_revision,
                    pid: Some(pid),
                },
            );
            processes.insert(pane_id, pid);
            tokens.insert(pane_id, token);
        }
        Ok(CloseConfirmation {
            structure_revision,
            processes,
            tokens,
        })
    }

    fn schedule_spawn(&self, pane_id: PaneId, spec: SpawnSpec) {
        let terminals = self.terminals.clone();
        let sender = self.sender.clone();
        tokio::spawn(async move {
            let spawn = terminals
                .create_with_id(pane_id, spec)
                .await
                .map_err(|error| error.to_string());
            let _ = sender
                .send(ActorMessage::SpawnFinished {
                    pane_id,
                    result: spawn,
                })
                .await;
        });
    }

    async fn spawn_finished(&mut self, pane_id: PaneId, spawn: Result<PaneInfo, String>) {
        match spawn {
            Ok(info) if self.model.terminal_running(pane_id, info.pid) => {}
            Ok(_) => {
                let terminals = self.terminals.clone();
                tokio::spawn(async move {
                    let _ = terminals.close(pane_id).await;
                });
            }
            Err(failure) => self.model.terminal_failed(pane_id, failure),
        }
        self.persist().await;
    }

    async fn terminal_event(&mut self, event: TerminalRuntimeEvent) {
        match event {
            TerminalRuntimeEvent::FactsChanged {
                pane_id,
                title,
                current_directory,
                progress,
            } => self
                .model
                .terminal_facts(pane_id, title, current_directory, progress),
            TerminalRuntimeEvent::Exited {
                pane_id,
                code,
                signal,
            } => {
                let _ = self.model.terminal_exited(pane_id, code, signal);
            }
        }
        self.persist().await;
    }
}

#[derive(serde::Deserialize)]
struct SubscribeRequest {
    after_revision: Option<u64>,
}

#[derive(serde::Deserialize)]
struct ApplyRequest {
    command: Command,
    expected_structure_revision: Option<u64>,
    #[serde(default)]
    spawn_specs: BTreeMap<PaneId, SpawnSpec>,
    #[serde(default)]
    confirmation_tokens: BTreeMap<PaneId, Uuid>,
}

#[derive(serde::Deserialize)]
struct PrepareCloseRequest {
    command: Command,
}

#[derive(serde::Serialize)]
struct CloseConfirmation {
    structure_revision: u64,
    processes: BTreeMap<PaneId, u32>,
    tokens: BTreeMap<PaneId, Uuid>,
}

struct CloseGrant {
    token: Uuid,
    structure_revision: u64,
    pid: Option<u32>,
}

enum ApplyWorkspaceError {
    Model(ModelError),
    SpawnSpecs,
    ConfirmationRequired(Vec<PaneId>),
}

impl From<ModelError> for ApplyWorkspaceError {
    fn from(error: ModelError) -> Self {
        Self::Model(error)
    }
}

#[derive(serde::Deserialize)]
struct PaneRequest {
    pane_id: PaneId,
    confirmation_token: Option<Uuid>,
}

fn result<T: serde::Serialize>(command_id: CommandId, value: T) -> HostControl {
    match serde_json::to_value(value) {
        Ok(result) => HostControl::Result { command_id, result },
        Err(serialization_error) => error(
            Some(command_id),
            ProtocolErrorCode::Internal,
            json!({"reason": serialization_error.to_string()}),
        ),
    }
}

fn invalid_request(command_id: CommandId, decode_error: serde_json::Error) -> HostControl {
    error(
        Some(command_id),
        ProtocolErrorCode::InvalidRequest,
        json!({"reason": decode_error.to_string()}),
    )
}

fn workspace_error(command_id: CommandId, model_error: ModelError) -> HostControl {
    match model_error {
        ModelError::StaleStructure { expected, actual } => error(
            Some(command_id),
            ProtocolErrorCode::StaleStructure,
            json!({"expected_structure_revision": expected, "current_structure_revision": actual}),
        ),
        ModelError::Reducer(reducer_error) => {
            let code = match reducer_error {
                ReducerError::NotFound => ProtocolErrorCode::NotFound,
                ReducerError::AlreadyExists
                | ReducerError::InvalidName
                | ReducerError::InvalidPlacement
                | ReducerError::DuplicateItem
                | ReducerError::AncestorAndDescendant
                | ReducerError::LastContainer
                | ReducerError::InvalidRatio
                | ReducerError::InvalidState(_) => ProtocolErrorCode::InvalidRequest,
            };
            error(
                Some(command_id),
                code,
                json!({"reason": reducer_error.to_string()}),
            )
        }
    }
}

fn terminal_error(command_id: CommandId, terminal_error: TerminalError) -> HostControl {
    let code = match terminal_error {
        TerminalError::NotFound => ProtocolErrorCode::NotFound,
        TerminalError::AlreadyExists | TerminalError::NotAttached | TerminalError::StaleWriter => {
            ProtocolErrorCode::InvalidRequest
        }
        TerminalError::Spawn(_)
        | TerminalError::InputTooLarge
        | TerminalError::InputQueueFull
        | TerminalError::Stopped
        | TerminalError::Pty(_)
        | TerminalError::State(_) => ProtocolErrorCode::Internal,
    };
    error(
        Some(command_id),
        code,
        json!({"reason": terminal_error.to_string()}),
    )
}

fn error(command_id: Option<CommandId>, code: ProtocolErrorCode, details: Value) -> HostControl {
    HostControl::Error {
        command_id,
        error: ProtocolError {
            code,
            details,
            retryable: false,
        },
    }
}

fn internal_error() -> ProtocolError {
    ProtocolError {
        code: ProtocolErrorCode::Internal,
        details: Value::Null,
        retryable: true,
    }
}
