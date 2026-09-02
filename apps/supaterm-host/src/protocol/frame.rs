use bytes::{Buf, Bytes, BytesMut};
use thiserror::Error;

pub const PREFACE: [u8; 12] = *b"SUPAHOST\0\x01\0\0";
pub const HEADER_LENGTH: usize = 9;
pub const MAX_CONTROL_PAYLOAD: usize = 16 * 1024 * 1024;
pub const MAX_TERMINAL_PAYLOAD: usize = 64 * 1024;

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
    TerminalInput = 3,
    TerminalOutput = 4,
    TerminalSnapshot = 5,
}

impl TryFrom<u8> for FrameKind {
    type Error = DecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::ClientControl),
            2 => Ok(Self::HostControl),
            3 => Ok(Self::TerminalInput),
            4 => Ok(Self::TerminalOutput),
            5 => Ok(Self::TerminalSnapshot),
            _ => Err(DecodeError::UnknownKind(value)),
        }
    }
}

impl FrameKind {
    pub fn maximum_payload(self) -> usize {
        match self {
            Self::ClientControl | Self::HostControl => MAX_CONTROL_PAYLOAD,
            Self::TerminalInput | Self::TerminalOutput | Self::TerminalSnapshot => {
                MAX_TERMINAL_PAYLOAD
            }
        }
    }

    fn accepts(self, direction: Direction) -> bool {
        matches!(
            (self, direction),
            (
                Self::ClientControl | Self::TerminalInput,
                Direction::ClientToHost
            ) | (
                Self::HostControl | Self::TerminalOutput | Self::TerminalSnapshot,
                Direction::HostToClient
            )
        )
    }

    fn accepts_stream(self, stream_id: u32) -> bool {
        match self {
            Self::ClientControl | Self::HostControl => stream_id == 0,
            Self::TerminalInput | Self::TerminalOutput | Self::TerminalSnapshot => stream_id != 0,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    pub kind: FrameKind,
    pub stream_id: u32,
    pub payload: Bytes,
}

impl Frame {
    pub fn encode(&self, destination: &mut BytesMut) -> Result<(), EncodeError> {
        if !self.kind.accepts_stream(self.stream_id) {
            return Err(EncodeError::InvalidStream {
                kind: self.kind,
                stream_id: self.stream_id,
            });
        }
        if self.payload.len() > self.kind.maximum_payload() {
            return Err(EncodeError::Oversized {
                kind: self.kind,
                length: self.payload.len(),
                maximum: self.kind.maximum_payload(),
            });
        }
        let length = u32::try_from(self.payload.len()).map_err(|_| EncodeError::Oversized {
            kind: self.kind,
            length: self.payload.len(),
            maximum: self.kind.maximum_payload(),
        })?;
        destination.extend_from_slice(&[self.kind as u8]);
        destination.extend_from_slice(&self.stream_id.to_be_bytes());
        destination.extend_from_slice(&length.to_be_bytes());
        destination.extend_from_slice(&self.payload);
        Ok(())
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum DecodeError {
    #[error("invalid connection preface")]
    InvalidPreface,
    #[error("unknown frame kind {0}")]
    UnknownKind(u8),
    #[error("frame kind {kind:?} is invalid in {direction:?}")]
    InvalidDirection {
        kind: FrameKind,
        direction: Direction,
    },
    #[error("frame kind {kind:?} cannot use stream {stream_id}")]
    InvalidStream { kind: FrameKind, stream_id: u32 },
    #[error("frame kind {kind:?} payload is {length} bytes, maximum is {maximum}")]
    Oversized {
        kind: FrameKind,
        length: usize,
        maximum: usize,
    },
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum EncodeError {
    #[error("frame kind {kind:?} cannot use stream {stream_id}")]
    InvalidStream { kind: FrameKind, stream_id: u32 },
    #[error("frame kind {kind:?} payload is {length} bytes, maximum is {maximum}")]
    Oversized {
        kind: FrameKind,
        length: usize,
        maximum: usize,
    },
}

pub struct FrameDecoder {
    direction: Direction,
    received_preface: bool,
}

impl FrameDecoder {
    pub fn new(direction: Direction) -> Self {
        Self {
            direction,
            received_preface: false,
        }
    }

    pub fn decode(&mut self, source: &mut BytesMut) -> Result<Option<Frame>, DecodeError> {
        if !self.received_preface {
            if source.len() < PREFACE.len() {
                return Ok(None);
            }
            if source[..PREFACE.len()] != PREFACE {
                return Err(DecodeError::InvalidPreface);
            }
            source.advance(PREFACE.len());
            self.received_preface = true;
        }
        if source.len() < HEADER_LENGTH {
            return Ok(None);
        }
        let kind = FrameKind::try_from(source[0])?;
        if !kind.accepts(self.direction) {
            return Err(DecodeError::InvalidDirection {
                kind,
                direction: self.direction,
            });
        }
        let stream_id = u32::from_be_bytes(source[1..5].try_into().unwrap());
        if !kind.accepts_stream(stream_id) {
            return Err(DecodeError::InvalidStream { kind, stream_id });
        }
        let length = u32::from_be_bytes(source[5..9].try_into().unwrap()) as usize;
        let maximum = kind.maximum_payload();
        if length > maximum {
            return Err(DecodeError::Oversized {
                kind,
                length,
                maximum,
            });
        }
        if source.len() < HEADER_LENGTH + length {
            return Ok(None);
        }
        source.advance(HEADER_LENGTH);
        let payload = source.split_to(length).freeze();
        Ok(Some(Frame {
            kind,
            stream_id,
            payload,
        }))
    }
}
