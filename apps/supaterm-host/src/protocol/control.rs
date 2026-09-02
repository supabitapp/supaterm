use serde::{Deserialize, Serialize};

use super::PROTOCOL_VERSION;

pub const BUILD_VERSION: &str = env!("SUPATERM_BUILD_VERSION");
pub const BUILD_IDENTITY: &str = env!("SUPATERM_BUILD_IDENTITY");
pub const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_PARSER_CONTINUATION_BYTES: u64 = 16 * 1024 * 1024;
pub const CAPABILITY_HOST_SHUTDOWN: &str = "host.shutdown";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProtocolLimits {
    pub snapshot_bytes: u64,
    pub parser_continuation_bytes: u64,
}

impl Default for ProtocolLimits {
    fn default() -> Self {
        Self {
            snapshot_bytes: MAX_SNAPSHOT_BYTES,
            parser_continuation_bytes: MAX_PARSER_CONTINUATION_BYTES,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientRole {
    Ui,
    Cli,
    Ssh,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Hello {
    pub protocol_version: u32,
    pub build_identity: String,
    pub role: ClientRole,
    pub client_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub limits: ProtocolLimits,
}

impl Hello {
    pub fn new(role: ClientRole, client_id: impl Into<String>) -> Self {
        let capabilities = match role {
            ClientRole::Cli => vec![CAPABILITY_HOST_SHUTDOWN.to_owned()],
            ClientRole::Ui | ClientRole::Ssh => Vec::new(),
        };
        Self {
            protocol_version: PROTOCOL_VERSION,
            build_identity: BUILD_IDENTITY.to_owned(),
            role,
            client_id: client_id.into(),
            capabilities,
            limits: ProtocolLimits::default(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello(Hello),
    Command {
        request_id: String,
        command_id: String,
        command: Command,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum Command {
    Snapshot,
    Ping,
    Shutdown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Welcome {
    pub protocol_version: u32,
    pub build_identity: String,
    pub host_id: String,
    pub epoch: String,
    pub revision: u64,
    pub structure_revision: u64,
    pub capabilities: Vec<String>,
    pub limits: ProtocolLimits,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct EmptyWorkspace {
    pub spaces: Vec<serde_json::Value>,
    pub windows: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EmptySnapshot {
    pub epoch: String,
    pub revision: u64,
    pub structure_revision: u64,
    pub workspace: EmptyWorkspace,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommandResult {
    Snapshot { snapshot: EmptySnapshot },
    Pong { accepted_commands: u64 },
    ShuttingDown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    HandshakeRequired,
    DuplicateHello,
    VersionMismatch,
    BuildMismatch,
    LimitMismatch,
    CapabilityRequired,
    InvalidMessage,
    InvalidFrame,
    InvalidIdentifier,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProtocolFailure {
    pub code: ErrorCode,
    pub detail: String,
    pub retryable: bool,
}

impl ProtocolFailure {
    pub fn new(code: ErrorCode, detail: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            detail: detail.into(),
            retryable,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostMessage {
    Welcome(Welcome),
    Result {
        request_id: String,
        command_id: String,
        result: CommandResult,
    },
    Error {
        request_id: Option<String>,
        command_id: Option<String>,
        error: ProtocolFailure,
    },
}
