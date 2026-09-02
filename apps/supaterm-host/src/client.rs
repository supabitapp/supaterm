use crate::protocol::control::{
    BuildIdentity, ClientControl, ClientId, ClientRole, CommandId, HostControl, Limits,
    PROTOCOL_VERSION, decode_host_control, encode_control,
};
use crate::protocol::frame::{Direction, Frame, FrameKind};
use crate::protocol::io::{FrameReader, FrameWriter};
use bytes::Bytes;
use serde_json::Value;
use std::io;
use std::path::PathBuf;
use thiserror::Error;
use tokio::net::UnixStream;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ClientConfiguration {
    pub socket: PathBuf,
    pub build: BuildIdentity,
    pub role: ClientRole,
    pub client_id: Option<ClientId>,
    pub capabilities: Vec<String>,
}

pub struct HostClient {
    reader: FrameReader<tokio::net::unix::OwnedReadHalf>,
    writer: FrameWriter<tokio::net::unix::OwnedWriteHalf>,
}

#[derive(Debug, Error)]
pub enum ClientError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("host closed the connection")]
    Closed,
    #[error("invalid host control: {0}")]
    InvalidControl(String),
    #[error("expected welcome, received {0:?}")]
    ExpectedWelcome(HostControl),
    #[error("host returned {0:?}")]
    Host(HostControl),
    #[error("response command id did not match")]
    MisdirectedResponse,
}

impl HostClient {
    pub async fn connect(configuration: ClientConfiguration) -> Result<Self, ClientError> {
        let stream = UnixStream::connect(&configuration.socket).await?;
        let (read_half, write_half) = stream.into_split();
        let mut client = Self {
            reader: FrameReader::new(read_half, Direction::HostToClient),
            writer: FrameWriter::new(write_half),
        };
        client
            .write_control(&ClientControl::Hello {
                protocol_version: PROTOCOL_VERSION,
                build: configuration.build,
                role: configuration.role,
                client_id: configuration.client_id,
                capabilities: configuration.capabilities,
                limits: Limits::default(),
            })
            .await?;
        let welcome = client.read_control().await?;
        if !matches!(welcome, HostControl::Welcome { .. }) {
            return Err(ClientError::ExpectedWelcome(welcome));
        }
        Ok(client)
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value, ClientError> {
        let command_id = CommandId(Uuid::new_v4());
        self.write_control(&ClientControl::Request {
            command_id,
            method: method.into(),
            params,
        })
        .await?;
        match self.read_control().await? {
            HostControl::Result {
                command_id: response_id,
                result,
            } if response_id == command_id => Ok(result),
            HostControl::Error {
                command_id: Some(response_id),
                ..
            } if response_id != command_id => Err(ClientError::MisdirectedResponse),
            response @ HostControl::Error { .. } => Err(ClientError::Host(response)),
            _ => Err(ClientError::MisdirectedResponse),
        }
    }

    async fn write_control(&mut self, control: &ClientControl) -> Result<(), ClientError> {
        let payload = encode_control(control)
            .map(Bytes::from)
            .map_err(|error| ClientError::InvalidControl(error.to_string()))?;
        self.writer
            .write(&Frame {
                kind: FrameKind::ClientControl,
                stream_id: 0,
                payload,
            })
            .await?;
        Ok(())
    }

    async fn read_control(&mut self) -> Result<HostControl, ClientError> {
        let frame = self.reader.read().await?.ok_or(ClientError::Closed)?;
        if frame.kind != FrameKind::HostControl || frame.stream_id != 0 {
            return Err(ClientError::InvalidControl("expected host control".into()));
        }
        decode_host_control(&frame.payload)
            .map_err(|error| ClientError::InvalidControl(error.to_string()))
    }
}
