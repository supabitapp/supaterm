use std::{collections::BTreeMap, path::PathBuf};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

use crate::{AttachmentId, BootId, ClientId, MachineId, RequestId, TerminalId};

pub const PROTOCOL_EPOCH: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TERMINAL_DATA_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientRole {
    App,
    Attach,
    Cli,
    Test,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostRole {
    Host,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientEnvelope {
    pub epoch: u32,
    pub role: ClientRole,
    pub request_id: RequestId,
    pub body: Request,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEnvelope {
    pub epoch: u32,
    pub role: HostRole,
    pub request_id: Option<RequestId>,
    pub body: HostMessage,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Hello {
        client_id: ClientId,
    },
    Create {
        terminal_id: TerminalId,
        command: CommandSpec,
        size: TerminalSize,
    },
    List,
    Get {
        terminal_id: TerminalId,
    },
    Attach {
        terminal_id: TerminalId,
    },
    Input {
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        data: TerminalData,
    },
    Resize {
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        size: TerminalSize,
    },
    Detach {
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
    },
    End {
        terminal_id: TerminalId,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HostMessage {
    Hello {
        machine_id: MachineId,
        boot_id: BootId,
    },
    Created {
        terminal: TerminalInfo,
    },
    Terminals {
        terminals: Vec<TerminalInfo>,
    },
    Terminal {
        terminal: TerminalInfo,
    },
    Attached {
        terminal: TerminalInfo,
        attachment_id: AttachmentId,
    },
    Ack,
    Error {
        code: ErrorCode,
        message: String,
    },
    Output {
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        sequence: u64,
        data: TerminalData,
    },
    Exited {
        terminal_id: TerminalId,
        exit: ProcessExit,
    },
}

impl HostMessage {
    pub fn is_event(&self) -> bool {
        matches!(self, Self::Output { .. } | Self::Exited { .. })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    Backpressure,
    Conflict,
    InvalidRequest,
    NotAttached,
    NotFound,
    Protocol,
    TerminalExited,
    TerminalInUse,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub argv: Vec<String>,
    pub cwd: PathBuf,
    pub environment: EnvironmentSpec,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSpec {
    pub inherit: bool,
    pub set: BTreeMap<String, String>,
    pub remove: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
    pub rows: u16,
    pub cols: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

impl Default for TerminalSize {
    fn default() -> Self {
        Self {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

impl From<TerminalSize> for portable_pty::PtySize {
    fn from(size: TerminalSize) -> Self {
        Self {
            rows: size.rows,
            cols: size.cols,
            pixel_width: size.pixel_width,
            pixel_height: size.pixel_height,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: TerminalId,
    pub boot_id: BootId,
    pub argv: Vec<String>,
    pub cwd: PathBuf,
    pub size: TerminalSize,
    pub status: TerminalStatus,
    pub next_sequence: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum TerminalStatus {
    Running,
    Exited { exit: ProcessExit },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ProcessExit {
    Code(u32),
    Signal(String),
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TerminalData(Vec<u8>);

impl TerminalData {
    pub fn new(bytes: impl Into<Vec<u8>>) -> Self {
        Self(bytes.into())
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }
}

impl From<Vec<u8>> for TerminalData {
    fn from(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }
}

impl From<&[u8]> for TerminalData {
    fn from(bytes: &[u8]) -> Self {
        Self(bytes.to_vec())
    }
}

impl Serialize for TerminalData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for TerminalData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        STANDARD.decode(value).map(Self).map_err(de::Error::custom)
    }
}
