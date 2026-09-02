use std::future::pending;
use std::time::Duration;

use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::host::{HostError, HostHandle};
use crate::protocol::{
    BUILD_IDENTITY, CAPABILITY_HOST_SHUTDOWN, ClientMessage, ClientRole, Command, ErrorCode, Frame,
    FrameKind, FrameReader, HostMessage, PROTOCOL_VERSION, ProtocolError, ProtocolFailure,
    ProtocolLimits, encode_preface,
};

use super::{OutboundConfig, OutboundError, OutboundSender, spawn_outbound};

const MAX_FAILURE_DETAIL_BYTES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectionOutcome {
    Disconnected,
    ShutdownRequested,
    Stopped,
    Rejected,
}

pub async fn serve_connection<R, W>(
    input: R,
    mut output: W,
    host: HostHandle,
    mut stop: watch::Receiver<bool>,
    outbound_config: OutboundConfig,
    handshake_timeout: Duration,
) -> Result<ConnectionOutcome, ConnectionError>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let handshake_deadline = Instant::now() + handshake_timeout;
    let mut reader = FrameReader::new(input, crate::protocol::Direction::ClientToHost);
    if !read_preface(&mut reader, &mut stop, handshake_deadline).await? {
        return Ok(ConnectionOutcome::Stopped);
    }
    output
        .write_all(&encode_preface())
        .await
        .map_err(ProtocolError::from)?;
    output.flush().await.map_err(ProtocolError::from)?;
    let (outbound, writer) = spawn_outbound(output, outbound_config)?;
    let outcome =
        serve_messages(&mut reader, &outbound, &host, &mut stop, handshake_deadline).await;
    drop(outbound);
    let writer_result = writer.await.map_err(|_| ConnectionError::WriterStopped)?;
    writer_result?;
    outcome
}

async fn read_preface<R: AsyncRead + Unpin>(
    reader: &mut FrameReader<R>,
    stop: &mut watch::Receiver<bool>,
    handshake_deadline: Instant,
) -> Result<bool, ConnectionError> {
    loop {
        if *stop.borrow() {
            return Ok(false);
        }
        tokio::select! {
            biased;
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return Ok(false);
                }
            }
            result = reader.read_preface() => {
                result?;
                return Ok(true);
            }
            _ = tokio::time::sleep_until(handshake_deadline) => {
                return Err(ConnectionError::HandshakeTimedOut);
            }
        }
    }
}

async fn serve_messages<R: AsyncRead + Unpin>(
    reader: &mut FrameReader<R>,
    outbound: &OutboundSender,
    host: &HostHandle,
    stop: &mut watch::Receiver<bool>,
    handshake_deadline: Instant,
) -> Result<ConnectionOutcome, ConnectionError> {
    let mut client = None;
    loop {
        let frame =
            match read_frame(reader, stop, client.is_none().then_some(handshake_deadline)).await? {
                IncomingFrame::Frame(Some(frame)) => frame,
                IncomingFrame::Frame(None) => return Ok(ConnectionOutcome::Disconnected),
                IncomingFrame::Invalid(error) => {
                    send_failure(
                        outbound,
                        None,
                        None,
                        ErrorCode::InvalidFrame,
                        error.to_string(),
                    )
                    .await?;
                    return Ok(ConnectionOutcome::Rejected);
                }
                IncomingFrame::Stopped => return Ok(ConnectionOutcome::Stopped),
            };
        if frame.kind() != FrameKind::ClientControl {
            send_failure(
                outbound,
                None,
                None,
                ErrorCode::InvalidFrame,
                "terminal frames are unavailable before attach",
            )
            .await?;
            return Ok(ConnectionOutcome::Rejected);
        }
        let message = match frame.decode_json::<ClientMessage>() {
            Ok(message) => message,
            Err(error) => {
                send_failure(
                    outbound,
                    None,
                    None,
                    ErrorCode::InvalidMessage,
                    error.to_string(),
                )
                .await?;
                return Ok(ConnectionOutcome::Rejected);
            }
        };
        match message {
            ClientMessage::Hello(hello) if client.is_none() => {
                if hello.protocol_version != PROTOCOL_VERSION {
                    send_failure(
                        outbound,
                        None,
                        None,
                        ErrorCode::VersionMismatch,
                        format!(
                            "protocol version {} does not match {}",
                            hello.protocol_version, PROTOCOL_VERSION
                        ),
                    )
                    .await?;
                    return Ok(ConnectionOutcome::Rejected);
                }
                if hello.build_identity != BUILD_IDENTITY {
                    send_failure(
                        outbound,
                        None,
                        None,
                        ErrorCode::BuildMismatch,
                        format!(
                            "build identity {} does not match {}",
                            hello.build_identity, BUILD_IDENTITY
                        ),
                    )
                    .await?;
                    return Ok(ConnectionOutcome::Rejected);
                }
                if hello.limits != ProtocolLimits::default() {
                    send_failure(
                        outbound,
                        None,
                        None,
                        ErrorCode::LimitMismatch,
                        "protocol limits do not match",
                    )
                    .await?;
                    return Ok(ConnectionOutcome::Rejected);
                }
                if !valid_identifier(&hello.client_id) {
                    send_failure(
                        outbound,
                        None,
                        None,
                        ErrorCode::InvalidIdentifier,
                        "invalid client_id",
                    )
                    .await?;
                    return Ok(ConnectionOutcome::Rejected);
                }
                let capabilities = if hello.role == ClientRole::Cli
                    && hello
                        .capabilities
                        .iter()
                        .any(|capability| capability == CAPABILITY_HOST_SHUTDOWN)
                {
                    vec![CAPABILITY_HOST_SHUTDOWN.to_owned()]
                } else {
                    Vec::new()
                };
                client = Some(AcceptedClient {
                    id: hello.client_id,
                    role: hello.role,
                    capabilities,
                });
                let mut welcome = host.welcome().await?;
                welcome.capabilities = client
                    .as_ref()
                    .map(|client| client.capabilities.clone())
                    .unwrap_or_default();
                send_message(outbound, &HostMessage::Welcome(welcome)).await?;
            }
            ClientMessage::Hello(_) => {
                send_failure(
                    outbound,
                    None,
                    None,
                    ErrorCode::DuplicateHello,
                    "hello was already accepted",
                )
                .await?;
                return Ok(ConnectionOutcome::Rejected);
            }
            ClientMessage::Command {
                request_id,
                command_id,
                command,
            } => {
                let Some(client) = client.clone() else {
                    send_failure(
                        outbound,
                        Some(request_id),
                        Some(command_id),
                        ErrorCode::HandshakeRequired,
                        "hello is required before commands",
                    )
                    .await?;
                    return Ok(ConnectionOutcome::Rejected);
                };
                if command == Command::Shutdown
                    && (client.role != ClientRole::Cli
                        || !client
                            .capabilities
                            .iter()
                            .any(|capability| capability == CAPABILITY_HOST_SHUTDOWN))
                {
                    send_failure(
                        outbound,
                        Some(request_id),
                        Some(command_id),
                        ErrorCode::CapabilityRequired,
                        CAPABILITY_HOST_SHUTDOWN,
                    )
                    .await?;
                    continue;
                }
                let execution = match host
                    .execute(client.id, request_id.clone(), command_id.clone(), command)
                    .await
                {
                    Ok(execution) => execution,
                    Err(HostError::InvalidIdentifier { .. }) => {
                        send_failure(
                            outbound,
                            Some(request_id),
                            Some(command_id),
                            ErrorCode::InvalidIdentifier,
                            "invalid request or command identifier",
                        )
                        .await?;
                        continue;
                    }
                    Err(error) => return Err(error.into()),
                };
                send_message(outbound, &execution.message).await?;
                if execution.shutdown {
                    return Ok(ConnectionOutcome::ShutdownRequested);
                }
            }
        }
    }
}

enum IncomingFrame {
    Frame(Option<Frame>),
    Invalid(ProtocolError),
    Stopped,
}

async fn read_frame<R: AsyncRead + Unpin>(
    reader: &mut FrameReader<R>,
    stop: &mut watch::Receiver<bool>,
    handshake_deadline: Option<Instant>,
) -> Result<IncomingFrame, ConnectionError> {
    loop {
        if *stop.borrow() {
            return Ok(IncomingFrame::Stopped);
        }
        tokio::select! {
            biased;
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return Ok(IncomingFrame::Stopped);
                }
            }
            frame = reader.read_frame() => {
                return Ok(match frame {
                    Ok(frame) => IncomingFrame::Frame(frame),
                    Err(error) => IncomingFrame::Invalid(error),
                });
            }
            _ = wait_for_deadline(handshake_deadline) => {
                return Err(ConnectionError::HandshakeTimedOut);
            }
        }
    }
}

async fn wait_for_deadline(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => pending().await,
    }
}

#[derive(Clone)]
struct AcceptedClient {
    id: String,
    role: ClientRole,
    capabilities: Vec<String>,
}

async fn send_failure(
    outbound: &OutboundSender,
    request_id: Option<String>,
    command_id: Option<String>,
    code: ErrorCode,
    detail: impl Into<String>,
) -> Result<(), ConnectionError> {
    let request_id = request_id.and_then(valid_correlation_id);
    let command_id = command_id.and_then(valid_correlation_id);
    send_message(
        outbound,
        &HostMessage::Error {
            request_id,
            command_id,
            error: ProtocolFailure::new(code, bounded_detail(detail.into()), false),
        },
    )
    .await
}

fn valid_correlation_id(value: String) -> Option<String> {
    valid_identifier(&value).then_some(value)
}

fn bounded_detail(mut detail: String) -> String {
    if detail.len() <= MAX_FAILURE_DETAIL_BYTES {
        return detail;
    }
    let mut boundary = MAX_FAILURE_DETAIL_BYTES;
    while !detail.is_char_boundary(boundary) {
        boundary -= 1;
    }
    detail.truncate(boundary);
    detail
}

async fn send_message(
    outbound: &OutboundSender,
    message: &HostMessage,
) -> Result<(), ConnectionError> {
    let frame = Frame::from_json(FrameKind::HostControl, message)?;
    outbound.send_and_flush(frame).await?;
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}

#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    #[error(transparent)]
    Outbound(#[from] OutboundError),
    #[error(transparent)]
    OutboundConfig(#[from] super::OutboundConfigError),
    #[error(transparent)]
    Host(#[from] HostError),
    #[error("client handshake timed out")]
    HandshakeTimedOut,
    #[error("outbound writer stopped")]
    WriterStopped,
}
