use bytes::{BufMut, Bytes, BytesMut};
use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};
use uuid::Uuid;

pub const OUTPUT_HEADER_LENGTH: usize = 8;
pub const SNAPSHOT_HEADER_LENGTH: usize = 24;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct PaneId(pub Uuid);

impl Display for PaneId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        Display::fmt(&self.0, formatter)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotEncoding {
    GhosttyV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalControl {
    Attached {
        snapshot_id: Uuid,
        boundary: u64,
    },
    SnapshotBegin {
        snapshot_id: Uuid,
        boundary: u64,
        encoding: SnapshotEncoding,
        declared_length: u64,
        limit: u64,
    },
    SnapshotEnd {
        snapshot_id: Uuid,
        total_length: u64,
        sha256: [u8; 32],
    },
    Ready {
        next_sequence: u64,
    },
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

pub fn encode_output(sequence: u64, bytes: &[u8]) -> Bytes {
    let mut payload = BytesMut::with_capacity(OUTPUT_HEADER_LENGTH + bytes.len());
    payload.put_u64(sequence);
    payload.extend_from_slice(bytes);
    payload.freeze()
}

pub fn decode_output(payload: &[u8]) -> Option<(u64, Bytes)> {
    let sequence = u64::from_be_bytes(payload.get(..OUTPUT_HEADER_LENGTH)?.try_into().ok()?);
    Some((
        sequence,
        Bytes::copy_from_slice(&payload[OUTPUT_HEADER_LENGTH..]),
    ))
}

pub fn encode_snapshot_chunk(snapshot_id: Uuid, offset: u64, bytes: &[u8]) -> Bytes {
    let mut payload = BytesMut::with_capacity(SNAPSHOT_HEADER_LENGTH + bytes.len());
    payload.extend_from_slice(snapshot_id.as_bytes());
    payload.put_u64(offset);
    payload.extend_from_slice(bytes);
    payload.freeze()
}

pub fn decode_snapshot_chunk(payload: &[u8]) -> Option<(Uuid, u64, Bytes)> {
    let snapshot_id = Uuid::from_slice(payload.get(..16)?).ok()?;
    let offset = u64::from_be_bytes(payload.get(16..SNAPSHOT_HEADER_LENGTH)?.try_into().ok()?);
    Some((
        snapshot_id,
        offset,
        Bytes::copy_from_slice(&payload[SNAPSHOT_HEADER_LENGTH..]),
    ))
}
