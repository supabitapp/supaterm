use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use thiserror::Error;
use tokio::sync::{mpsc, oneshot};

use crate::protocol::{
    BUILD_IDENTITY, Command, CommandResult, EmptySnapshot, EmptyWorkspace, HostMessage,
    PROTOCOL_VERSION, ProtocolLimits, Welcome,
};
use crate::random_identifier;

#[derive(Clone, Debug)]
pub struct HostConfig {
    pub host_id: String,
    pub dedupe_capacity: usize,
    pub dedupe_ttl: Duration,
}

impl HostConfig {
    pub fn new(host_id: impl Into<String>) -> Self {
        Self {
            host_id: host_id.into(),
            dedupe_capacity: 256,
            dedupe_ttl: Duration::from_secs(5 * 60),
        }
    }
}

#[derive(Clone)]
pub struct HostHandle {
    sender: mpsc::Sender<ActorRequest>,
}

impl HostHandle {
    pub fn start(config: HostConfig) -> Self {
        let (sender, receiver) = mpsc::channel(128);
        tokio::spawn(run_actor(config, receiver));
        Self { sender }
    }

    pub async fn welcome(&self) -> Result<Welcome, HostError> {
        let (reply, receive) = oneshot::channel();
        self.sender
            .send(ActorRequest::Welcome { reply })
            .await
            .map_err(|_| HostError::Unavailable)?;
        receive.await.map_err(|_| HostError::Unavailable)
    }

    pub async fn execute(
        &self,
        client_id: String,
        request_id: String,
        command_id: String,
        command: Command,
    ) -> Result<CommandExecution, HostError> {
        validate_identifier("client_id", &client_id)?;
        validate_identifier("request_id", &request_id)?;
        validate_identifier("command_id", &command_id)?;
        let (reply, receive) = oneshot::channel();
        self.sender
            .send(ActorRequest::Execute {
                client_id,
                request_id,
                command_id,
                command,
                reply,
            })
            .await
            .map_err(|_| HostError::Unavailable)?;
        receive.await.map_err(|_| HostError::Unavailable)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandExecution {
    pub message: HostMessage,
    pub shutdown: bool,
}

enum ActorRequest {
    Welcome {
        reply: oneshot::Sender<Welcome>,
    },
    Execute {
        client_id: String,
        request_id: String,
        command_id: String,
        command: Command,
        reply: oneshot::Sender<CommandExecution>,
    },
}

#[derive(Clone)]
struct CachedOutcome {
    result: CommandResult,
    shutdown: bool,
    inserted: Instant,
}

struct ActorState {
    config: HostConfig,
    epoch: String,
    revision: u64,
    structure_revision: u64,
    accepted_commands: u64,
    cache: HashMap<(String, String), CachedOutcome>,
    cache_order: VecDeque<(String, String)>,
}

async fn run_actor(config: HostConfig, mut receiver: mpsc::Receiver<ActorRequest>) {
    let mut state = ActorState {
        config,
        epoch: new_epoch(),
        revision: 0,
        structure_revision: 0,
        accepted_commands: 0,
        cache: HashMap::new(),
        cache_order: VecDeque::new(),
    };
    while let Some(request) = receiver.recv().await {
        match request {
            ActorRequest::Welcome { reply } => {
                let _ = reply.send(state.welcome());
            }
            ActorRequest::Execute {
                client_id,
                request_id,
                command_id,
                command,
                reply,
            } => {
                let execution = state.execute(client_id, request_id, command_id, command);
                let _ = reply.send(execution);
            }
        }
    }
}

impl ActorState {
    fn welcome(&self) -> Welcome {
        Welcome {
            protocol_version: PROTOCOL_VERSION,
            build_identity: BUILD_IDENTITY.to_owned(),
            host_id: self.config.host_id.clone(),
            epoch: self.epoch.clone(),
            revision: self.revision,
            structure_revision: self.structure_revision,
            capabilities: Vec::new(),
            limits: ProtocolLimits::default(),
        }
    }

    fn execute(
        &mut self,
        client_id: String,
        request_id: String,
        command_id: String,
        command: Command,
    ) -> CommandExecution {
        self.expire_cache();
        let key = (client_id, command_id.clone());
        if let Some(outcome) = self.cache.get(&key) {
            return CommandExecution {
                message: HostMessage::Result {
                    request_id,
                    command_id,
                    result: outcome.result.clone(),
                },
                shutdown: outcome.shutdown,
            };
        }
        self.accepted_commands += 1;
        let (result, shutdown) = match command {
            Command::Snapshot => (
                CommandResult::Snapshot {
                    snapshot: EmptySnapshot {
                        epoch: self.epoch.clone(),
                        revision: self.revision,
                        structure_revision: self.structure_revision,
                        workspace: EmptyWorkspace::default(),
                    },
                },
                false,
            ),
            Command::Ping => (
                CommandResult::Pong {
                    accepted_commands: self.accepted_commands,
                },
                false,
            ),
            Command::Shutdown => (CommandResult::ShuttingDown, true),
        };
        if self.config.dedupe_capacity > 0 {
            while self.cache.len() >= self.config.dedupe_capacity {
                self.remove_oldest();
            }
            self.cache.insert(
                key.clone(),
                CachedOutcome {
                    result: result.clone(),
                    shutdown,
                    inserted: Instant::now(),
                },
            );
            self.cache_order.push_back(key);
        }
        CommandExecution {
            message: HostMessage::Result {
                request_id,
                command_id,
                result,
            },
            shutdown,
        }
    }

    fn expire_cache(&mut self) {
        loop {
            let Some(key) = self.cache_order.front() else {
                return;
            };
            let Some(outcome) = self.cache.get(key) else {
                self.cache_order.pop_front();
                continue;
            };
            if outcome.inserted.elapsed() < self.config.dedupe_ttl {
                return;
            }
            self.remove_oldest();
        }
    }

    fn remove_oldest(&mut self) {
        if let Some(key) = self.cache_order.pop_front() {
            self.cache.remove(&key);
        }
    }
}

fn validate_identifier(name: &'static str, value: &str) -> Result<(), HostError> {
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        Err(HostError::InvalidIdentifier { name })
    } else {
        Ok(())
    }
}

fn new_epoch() -> String {
    random_identifier("")
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum HostError {
    #[error("host actor is unavailable")]
    Unavailable,
    #[error("invalid {name}")]
    InvalidIdentifier { name: &'static str },
}
