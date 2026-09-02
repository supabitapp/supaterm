use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::{Display, Formatter};
use thiserror::Error;
use uuid::Uuid;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAXIMUM_SNAPSHOT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAXIMUM_CONTINUATION_BYTES: u64 = 16 * 1024 * 1024;

pub fn current_build_identity() -> BuildIdentity {
    BuildIdentity {
        version: env!("CARGO_PKG_VERSION").into(),
        fingerprint: option_env!("SUPATERM_HOST_BUILD_FINGERPRINT")
            .unwrap_or(env!("CARGO_PKG_VERSION"))
            .into(),
    }
}

macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl Display for $name {
            fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
                Display::fmt(&self.0, formatter)
            }
        }
    };
}

uuid_id!(ClientId);
uuid_id!(CommandId);
uuid_id!(HostId);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BuildIdentity {
    pub version: String,
    pub fingerprint: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientRole {
    Ui,
    Cli,
    Hook,
    Bridge,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Limits {
    pub maximum_snapshot_bytes: u64,
    pub maximum_continuation_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            maximum_snapshot_bytes: MAXIMUM_SNAPSHOT_BYTES,
            maximum_continuation_bytes: MAXIMUM_CONTINUATION_BYTES,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientControl {
    Hello {
        protocol_version: u16,
        build: BuildIdentity,
        role: ClientRole,
        client_id: Option<ClientId>,
        capabilities: Vec<String>,
        limits: Limits,
    },
    Request {
        command_id: CommandId,
        method: String,
        #[serde(default)]
        params: Value,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostControl {
    Welcome {
        protocol_version: u16,
        build: BuildIdentity,
        host_id: HostId,
        epoch: Uuid,
        revision: u64,
        structure_revision: u64,
        capabilities: Vec<String>,
        limits: Limits,
    },
    Result {
        command_id: CommandId,
        result: Value,
    },
    Error {
        command_id: Option<CommandId>,
        error: ProtocolError,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProtocolError {
    pub code: ProtocolErrorCode,
    #[serde(default)]
    pub details: Value,
    pub retryable: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolErrorCode {
    ProtocolMismatch,
    HelloRequired,
    UnexpectedHello,
    InvalidRequest,
    MethodNotFound,
    PermissionDenied,
    StaleStructure,
    ResyncRequired,
    AmbiguousTarget,
    NotFound,
    ConfirmationRequired,
    CapabilityUnavailable,
    Internal,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ControlDecodeError {
    #[error("control payload is not UTF-8")]
    InvalidUtf8,
    #[error("malformed control JSON: {0}")]
    MalformedJson(String),
}

pub fn encode_control<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(value)
}

pub fn decode_client_control(payload: &[u8]) -> Result<ClientControl, ControlDecodeError> {
    let json = std::str::from_utf8(payload).map_err(|_| ControlDecodeError::InvalidUtf8)?;
    serde_json::from_str(json).map_err(|error| ControlDecodeError::MalformedJson(error.to_string()))
}

pub fn decode_host_control(payload: &[u8]) -> Result<HostControl, ControlDecodeError> {
    let json = std::str::from_utf8(payload).map_err(|_| ControlDecodeError::InvalidUtf8)?;
    serde_json::from_str(json).map_err(|error| ControlDecodeError::MalformedJson(error.to_string()))
}
