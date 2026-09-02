use std::path::Path;

use thiserror::Error;
use tokio::net::UnixStream;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};

use crate::protocol::{
    BUILD_IDENTITY, ClientMessage, Command, Direction, Frame, FrameKind, FrameReader, FrameWriter,
    Hello, HostMessage, PROTOCOL_VERSION, ProtocolError, ProtocolFailure, ProtocolLimits, Welcome,
};

use super::{UnixTransportError, verify_peer_uid};

const CONNECTION_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

pub struct ReferenceClient {
    reader: FrameReader<OwnedReadHalf>,
    writer: FrameWriter<OwnedWriteHalf>,
    pub welcome: Welcome,
}

impl ReferenceClient {
    pub async fn connect(path: &Path, hello: Hello) -> Result<Self, ClientError> {
        tokio::time::timeout(CONNECTION_TIMEOUT, Self::connect_inner(path, hello))
            .await
            .map_err(|_| ClientError::TimedOut)?
    }

    async fn connect_inner(path: &Path, hello: Hello) -> Result<Self, ClientError> {
        let stream = UnixStream::connect(path).await?;
        verify_peer_uid(&stream)?;
        let (read, write) = stream.into_split();
        let mut reader = FrameReader::new(read, Direction::HostToClient);
        let mut writer = FrameWriter::new(write);
        writer.write_preface().await?;
        reader.read_preface().await?;
        let expected_build = hello.build_identity.clone();
        let expected_limits = hello.limits;
        let requested_capabilities = hello.capabilities.clone();
        writer
            .write_frame(&Frame::from_json(
                FrameKind::ClientControl,
                &ClientMessage::Hello(hello),
            )?)
            .await?;
        let message = read_message(&mut reader).await?;
        let welcome = match message {
            HostMessage::Welcome(welcome) => welcome,
            HostMessage::Error { error, .. } => return Err(ClientError::Rejected(error)),
            _ => return Err(ClientError::UnexpectedResponse),
        };
        if welcome.protocol_version != PROTOCOL_VERSION
            || welcome.build_identity != expected_build
            || welcome.build_identity != BUILD_IDENTITY
            || welcome.limits != expected_limits
            || welcome.limits != ProtocolLimits::default()
            || welcome
                .capabilities
                .iter()
                .any(|capability| !requested_capabilities.contains(capability))
        {
            return Err(ClientError::IncompatibleWelcome);
        }
        Ok(Self {
            reader,
            writer,
            welcome,
        })
    }

    pub async fn request(
        &mut self,
        request_id: impl Into<String>,
        command_id: impl Into<String>,
        command: Command,
    ) -> Result<HostMessage, ClientError> {
        let request_id = request_id.into();
        let command_id = command_id.into();
        self.writer
            .write_frame(&Frame::from_json(
                FrameKind::ClientControl,
                &ClientMessage::Command {
                    request_id: request_id.clone(),
                    command_id: command_id.clone(),
                    command,
                },
            )?)
            .await?;
        let message = read_message(&mut self.reader).await?;
        match &message {
            HostMessage::Result {
                request_id: received_request,
                command_id: received_command,
                ..
            }
            | HostMessage::Error {
                request_id: Some(received_request),
                command_id: Some(received_command),
                ..
            } if received_request == &request_id && received_command == &command_id => Ok(message),
            _ => Err(ClientError::MismatchedResponse {
                request_id,
                command_id,
            }),
        }
    }
}

async fn read_message<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut FrameReader<R>,
) -> Result<HostMessage, ClientError> {
    let frame = reader
        .read_frame()
        .await?
        .ok_or(ClientError::UnexpectedEof)?;
    if frame.kind() != FrameKind::HostControl {
        return Err(ClientError::UnexpectedResponse);
    }
    Ok(frame.decode_json()?)
}

#[derive(Debug, Error)]
pub enum ClientError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    #[error(transparent)]
    Unix(#[from] UnixTransportError),
    #[error("host rejected the connection: {0:?}")]
    Rejected(ProtocolFailure),
    #[error("host returned an unexpected response")]
    UnexpectedResponse,
    #[error("host closed before a response")]
    UnexpectedEof,
    #[error("host response did not match request {request_id} and command {command_id}")]
    MismatchedResponse {
        request_id: String,
        command_id: String,
    },
    #[error("host welcome does not match the requested protocol")]
    IncompatibleWelcome,
    #[error("host connection timed out")]
    TimedOut,
}
