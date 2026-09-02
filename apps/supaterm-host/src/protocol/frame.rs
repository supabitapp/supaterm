use bytes::{Buf, BytesMut};
use serde::de::DeserializeOwned;
use thiserror::Error;

pub const PROTOCOL_VERSION: u32 = 1;
pub const GENERAL_FRAME_LIMIT: usize = 16 * 1024 * 1024;
pub const TERMINAL_FRAME_LIMIT: usize = 64 * 1024;
const MAGIC: &[u8; 8] = b"SUPATERM";
const PREFACE_LENGTH: usize = MAGIC.len() + size_of::<u32>();
const FRAME_HEADER_LENGTH: usize = size_of::<u8>() + size_of::<u32>() + size_of::<u32>();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    ClientToHost,
    HostToClient,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum FrameKind {
    ClientControl = 1,
    HostControl = 2,
    TerminalInput = 16,
    TerminalOutput = 17,
    TerminalSnapshot = 18,
}

impl FrameKind {
    pub fn direction(self) -> Direction {
        match self {
            Self::ClientControl | Self::TerminalInput => Direction::ClientToHost,
            Self::HostControl | Self::TerminalOutput | Self::TerminalSnapshot => {
                Direction::HostToClient
            }
        }
    }

    pub fn maximum_payload_length(self) -> usize {
        match self {
            Self::ClientControl | Self::HostControl => GENERAL_FRAME_LIMIT,
            Self::TerminalInput | Self::TerminalOutput | Self::TerminalSnapshot => {
                TERMINAL_FRAME_LIMIT
            }
        }
    }

    pub fn is_control(self) -> bool {
        matches!(self, Self::ClientControl | Self::HostControl)
    }
}

impl TryFrom<u8> for FrameKind {
    type Error = ProtocolError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::ClientControl),
            2 => Ok(Self::HostControl),
            16 => Ok(Self::TerminalInput),
            17 => Ok(Self::TerminalOutput),
            18 => Ok(Self::TerminalSnapshot),
            kind => Err(ProtocolError::UnknownFrameKind { kind }),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    kind: FrameKind,
    stream_id: u32,
    payload: Vec<u8>,
}

impl Frame {
    pub fn new(kind: FrameKind, stream_id: u32, payload: Vec<u8>) -> Result<Self, ProtocolError> {
        validate_stream(kind, stream_id)?;
        validate_length(kind, payload.len())?;
        Ok(Self {
            kind,
            stream_id,
            payload,
        })
    }

    pub fn from_json<T: serde::Serialize>(
        kind: FrameKind,
        value: &T,
    ) -> Result<Self, ProtocolError> {
        if !kind.is_control() {
            return Err(ProtocolError::ExpectedControl { kind });
        }
        let payload = serde_json::to_vec(value).map_err(|error| ProtocolError::InvalidJson {
            reason: error.to_string(),
        })?;
        Self::new(kind, 0, payload)
    }

    pub fn decode_json<T: DeserializeOwned>(&self) -> Result<T, ProtocolError> {
        if !self.kind.is_control() {
            return Err(ProtocolError::ExpectedControl { kind: self.kind });
        }
        serde_json::from_slice(&self.payload).map_err(|error| ProtocolError::InvalidJson {
            reason: error.to_string(),
        })
    }

    pub fn kind(&self) -> FrameKind {
        self.kind
    }

    pub fn stream_id(&self) -> u32 {
        self.stream_id
    }

    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    pub fn encoded_len(&self) -> usize {
        FRAME_HEADER_LENGTH + self.payload.len()
    }

    pub fn encode(&self) -> Vec<u8> {
        let payload_length =
            u32::try_from(self.payload.len()).expect("validated frame length fits u32");
        let mut bytes = Vec::with_capacity(self.encoded_len());
        bytes.push(self.kind as u8);
        bytes.extend_from_slice(&self.stream_id.to_be_bytes());
        bytes.extend_from_slice(&payload_length.to_be_bytes());
        bytes.extend_from_slice(&self.payload);
        bytes
    }
}

#[derive(Debug)]
pub struct PrefaceDecoder;

impl PrefaceDecoder {
    pub fn new() -> Self {
        Self
    }

    pub fn decode(&mut self, bytes: &mut BytesMut) -> Result<Option<()>, ProtocolError> {
        if bytes.len() < PREFACE_LENGTH {
            return Ok(None);
        }
        if &bytes[..MAGIC.len()] != MAGIC {
            return Err(ProtocolError::InvalidMagic);
        }
        let received = u32::from_be_bytes(
            bytes[MAGIC.len()..PREFACE_LENGTH]
                .try_into()
                .expect("preface version has fixed width"),
        );
        if received != PROTOCOL_VERSION {
            return Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                received,
            });
        }
        bytes.advance(PREFACE_LENGTH);
        Ok(Some(()))
    }
}

impl Default for PrefaceDecoder {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub struct FrameDecoder {
    direction: Direction,
}

impl FrameDecoder {
    pub fn new(direction: Direction) -> Self {
        Self { direction }
    }

    pub fn decode(&mut self, bytes: &mut BytesMut) -> Result<Option<Frame>, ProtocolError> {
        if bytes.len() < FRAME_HEADER_LENGTH {
            return Ok(None);
        }
        let kind = FrameKind::try_from(bytes[0])?;
        if kind.direction() != self.direction {
            return Err(ProtocolError::WrongDirection {
                kind,
                expected: self.direction,
                received: kind.direction(),
            });
        }
        let stream_id = u32::from_be_bytes(bytes[1..5].try_into().expect("stream has fixed width"));
        validate_stream(kind, stream_id)?;
        let length = u32::from_be_bytes(bytes[5..9].try_into().expect("length has fixed width"));
        validate_length(kind, length as usize)?;
        let encoded_length = FRAME_HEADER_LENGTH + length as usize;
        if bytes.len() < encoded_length {
            return Ok(None);
        }
        bytes.advance(FRAME_HEADER_LENGTH);
        let payload = bytes.split_to(length as usize).to_vec();
        Frame::new(kind, stream_id, payload).map(Some)
    }
}

pub fn encode_preface() -> [u8; PREFACE_LENGTH] {
    let mut bytes = [0; PREFACE_LENGTH];
    bytes[..MAGIC.len()].copy_from_slice(MAGIC);
    bytes[MAGIC.len()..].copy_from_slice(&PROTOCOL_VERSION.to_be_bytes());
    bytes
}

fn validate_stream(kind: FrameKind, stream_id: u32) -> Result<(), ProtocolError> {
    let valid = if kind.is_control() {
        stream_id == 0
    } else {
        stream_id != 0
    };
    if valid {
        Ok(())
    } else {
        Err(ProtocolError::InvalidStream { kind, stream_id })
    }
}

fn validate_length(kind: FrameKind, length: usize) -> Result<(), ProtocolError> {
    let maximum = kind.maximum_payload_length();
    if length <= maximum {
        Ok(())
    } else {
        Err(ProtocolError::FrameTooLarge {
            kind,
            length,
            maximum,
        })
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProtocolError {
    #[error("invalid protocol magic")]
    InvalidMagic,
    #[error("protocol version {received} does not match {expected}")]
    VersionMismatch { expected: u32, received: u32 },
    #[error("unknown frame kind {kind}")]
    UnknownFrameKind { kind: u8 },
    #[error("frame kind {kind:?} has direction {received:?}, expected {expected:?}")]
    WrongDirection {
        kind: FrameKind,
        expected: Direction,
        received: Direction,
    },
    #[error("frame kind {kind:?} cannot use stream {stream_id}")]
    InvalidStream { kind: FrameKind, stream_id: u32 },
    #[error("frame kind {kind:?} payload length {length} exceeds {maximum}")]
    FrameTooLarge {
        kind: FrameKind,
        length: usize,
        maximum: usize,
    },
    #[error("frame kind {kind:?} is not a control frame")]
    ExpectedControl { kind: FrameKind },
    #[error("invalid control JSON: {reason}")]
    InvalidJson { reason: String },
    #[error("unexpected EOF while reading {phase}")]
    UnexpectedEof { phase: &'static str },
    #[error("I/O error: {message}")]
    Io { message: String },
}

impl From<std::io::Error> for ProtocolError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}
