use crate::protocol::control::{
    BuildIdentity, ClientId, ClientRole, CommandId, HostControl, HostId, ProtocolError,
    ProtocolErrorCode,
};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
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
}

impl HostActor {
    pub fn spawn(configuration: HostConfiguration) -> Self {
        let (sender, receiver) = mpsc::channel(ACTOR_QUEUE_CAPACITY);
        tokio::spawn(run(configuration, receiver));
        Self { sender }
    }

    pub async fn status(&self) -> Result<HostStatus, ProtocolError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ActorMessage::Status { reply })
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
    revision: u64,
    structure_revision: u64,
    command_results: HashMap<CommandKey, HostControl>,
    command_order: VecDeque<CommandKey>,
}

async fn run(configuration: HostConfiguration, mut receiver: mpsc::Receiver<ActorMessage>) {
    let mut state = ActorState {
        configuration,
        revision: 0,
        structure_revision: 0,
        command_results: HashMap::new(),
        command_order: VecDeque::new(),
    };
    while let Some(message) = receiver.recv().await {
        match message {
            ActorMessage::Status { reply } => {
                let _ = reply.send(state.status());
            }
            ActorMessage::Execute {
                client_id,
                role,
                command_id,
                method,
                params,
                reply,
            } => {
                let result = state.execute(client_id, role, command_id, method, params);
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
            revision: self.revision,
            structure_revision: self.structure_revision,
            capabilities: self.configuration.capabilities.clone(),
        }
    }

    fn execute(
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
                "state.snapshot" if params.is_null() => HostControl::Result {
                    command_id,
                    result: json!({
                        "epoch": self.configuration.epoch,
                        "revision": self.revision,
                        "structure_revision": self.structure_revision,
                        "workspace": {
                            "spaces": [],
                            "windows": []
                        },
                        "client_state": null,
                        "pane_facts": []
                    }),
                },
                "state.snapshot" => error(
                    Some(command_id),
                    ProtocolErrorCode::InvalidRequest,
                    json!({"method": method}),
                ),
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
