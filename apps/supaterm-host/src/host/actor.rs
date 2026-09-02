use crate::protocol::control::{
    BuildIdentity, ClientId, ClientRole, CommandId, HostControl, HostId, ProtocolError,
    ProtocolErrorCode,
};
use crate::protocol::terminal::PaneId;
use crate::terminal::actor::{TerminalError, TerminalRegistry};
use crate::terminal::pty::SpawnSpec;
use crate::workspace::model::{SpaceId, WindowId, Workspace};
use crate::workspace::persistence::{DurableDocument, PersistenceWorker};
use crate::workspace::reducer::{Command, ReducerError};
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
        let terminals = TerminalRegistry::spawn();
        let model = HostModel::new(document.workspace, document.clients, 2048, 16 * 1024 * 1024)
            .with_epoch(configuration.epoch);
        tokio::spawn(run(
            configuration,
            terminals.clone(),
            model,
            document.settings,
            persistence,
            receiver,
        ));
        Self { sender, terminals }
    }

    pub fn terminals(&self) -> &TerminalRegistry {
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
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct CommandKey {
    client_id: ClientId,
    command_id: CommandId,
}

struct ActorState {
    configuration: HostConfiguration,
    terminals: TerminalRegistry,
    model: HostModel,
    settings: BTreeMap<String, Value>,
    persistence: Option<PersistenceWorker>,
    command_results: HashMap<CommandKey, HostControl>,
    command_order: VecDeque<CommandKey>,
}

async fn run(
    configuration: HostConfiguration,
    terminals: TerminalRegistry,
    model: HostModel,
    settings: BTreeMap<String, Value>,
    persistence: Option<PersistenceWorker>,
    mut receiver: mpsc::Receiver<ActorMessage>,
) {
    let mut state = ActorState {
        configuration,
        terminals,
        model,
        settings,
        persistence,
        command_results: HashMap::new(),
        command_order: VecDeque::new(),
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
                    Ok(request) => {
                        match self
                            .model
                            .apply(request.command, request.expected_structure_revision)
                        {
                            Ok(applied) => {
                                self.persist().await;
                                result(command_id, applied)
                            }
                            Err(model_error) => workspace_error(command_id, model_error),
                        }
                    }
                    Err(decode_error) => invalid_request(command_id, decode_error),
                },
                "terminal.create" => match serde_json::from_value::<SpawnSpec>(params) {
                    Ok(spec) => match self.terminals.create(spec).await {
                        Ok(info) => result(command_id, info),
                        Err(error) => terminal_error(command_id, error),
                    },
                    Err(decode_error) => error(
                        Some(command_id),
                        ProtocolErrorCode::InvalidRequest,
                        json!({"reason": decode_error.to_string()}),
                    ),
                },
                "terminal.list" if params.is_null() => match self.terminals.list().await {
                    Ok(panes) => result(command_id, panes),
                    Err(error) => terminal_error(command_id, error),
                },
                "terminal.close" => match serde_json::from_value::<PaneRequest>(params) {
                    Ok(request) => match self.terminals.close(request.pane_id).await {
                        Ok(()) => result(command_id, Value::Null),
                        Err(error) => terminal_error(command_id, error),
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
}

#[derive(serde::Deserialize)]
struct SubscribeRequest {
    after_revision: Option<u64>,
}

#[derive(serde::Deserialize)]
struct ApplyRequest {
    command: Command,
    expected_structure_revision: Option<u64>,
}

#[derive(serde::Deserialize)]
struct PaneRequest {
    pane_id: PaneId,
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
