use crate::host::actor::HostActor;
use crate::protocol::connection::ConnectionSession;
use crate::protocol::control::{
    ClientControl, CommandId, HostControl, MAXIMUM_SNAPSHOT_BYTES, ProtocolError,
    ProtocolErrorCode, decode_client_control, encode_control,
};
use crate::protocol::frame::{Direction, Frame, FrameKind, HEADER_LENGTH, MAX_TERMINAL_PAYLOAD};
use crate::protocol::io::{FrameReader, FrameWriter};
use crate::protocol::terminal::{
    OUTPUT_HEADER_LENGTH, PaneId, SnapshotEncoding, TerminalControl, encode_output,
    encode_snapshot_chunk,
};
use crate::runtime::{RuntimeError, RuntimePaths, ServeLock, SocketState};
use crate::terminal::actor::{Attachment, OutputEvent, TerminalError, Viewport};
use crate::workspace::replay::Subscription;
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};
use tokio::task::JoinHandle;

const CONTROL_QUEUE_CAPACITY: usize = 128;
const TERMINAL_QUEUE_CAPACITY: usize = 128;
const CONTROL_BYTE_BUDGET: usize = 16 * 1024 * 1024 + HEADER_LENGTH;
const TERMINAL_BYTE_BUDGET: usize = 4 * 1024 * 1024;

pub struct UnixServer {
    listener: UnixListener,
    socket: PathBuf,
    lock: ServeLock,
}

impl UnixServer {
    pub async fn bind(paths: &RuntimePaths) -> Result<Self, RuntimeError> {
        let lock = paths.acquire_serve_lock()?;
        if paths.prepare_socket()? == SocketState::Live {
            return Err(RuntimeError::AlreadyServing);
        }
        let listener = UnixListener::bind(&paths.socket)?;
        fs::set_permissions(&paths.socket, fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            socket: paths.socket.clone(),
            lock,
        })
    }

    pub async fn accept(&self) -> io::Result<(UnixStream, tokio::net::unix::SocketAddr)> {
        self.listener.accept().await
    }
}

impl Drop for UnixServer {
    fn drop(&mut self) {
        let _ = &self.lock;
        if let Ok(metadata) = fs::symlink_metadata(&self.socket)
            && std::os::unix::fs::FileTypeExt::is_socket(&metadata.file_type())
        {
            let _ = fs::remove_file(&self.socket);
        }
    }
}

struct StreamAttachment {
    pane_id: PaneId,
    ready: Arc<AtomicBool>,
    writer_generation: Option<u64>,
    task: JoinHandle<()>,
}

#[derive(Clone)]
struct Outbound {
    control: mpsc::Sender<QueuedFrame>,
    terminal: mpsc::Sender<QueuedFrame>,
    control_budget: Arc<Semaphore>,
    terminal_budget: Arc<Semaphore>,
    sequence: Arc<AtomicU64>,
}

struct QueuedFrame {
    sequence: u64,
    frame: Frame,
    _permit: OwnedSemaphorePermit,
}

impl Outbound {
    async fn control(&self, control: HostControl) -> io::Result<()> {
        let payload = Bytes::from(encode_control(&control).map_err(io::Error::other)?);
        let frame = Frame {
            kind: FrameKind::HostControl,
            stream_id: 0,
            payload,
        };
        self.send(frame, true).await
    }

    async fn terminal(&self, frame: Frame) -> io::Result<()> {
        self.send(frame, false).await
    }

    async fn send(&self, frame: Frame, control: bool) -> io::Result<()> {
        let size = frame.payload.len().saturating_add(HEADER_LENGTH);
        let budget = if control {
            self.control_budget.clone()
        } else {
            self.terminal_budget.clone()
        };
        let permits = u32::try_from(size)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame is too large"))?;
        let permit = budget
            .acquire_many_owned(permits)
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "connection closed"))?;
        let sender = if control {
            &self.control
        } else {
            &self.terminal
        };
        let slot = sender
            .reserve()
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "connection closed"))?;
        slot.send(QueuedFrame {
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            frame,
            _permit: permit,
        });
        Ok(())
    }
}

pub async fn serve_connection(stream: UnixStream, actor: HostActor) -> io::Result<()> {
    let expected_uid = unsafe { libc::geteuid() };
    let actual_uid = peer_uid(&stream)?;
    if actual_uid != expected_uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("peer uid {actual_uid} does not match {expected_uid}"),
        ));
    }
    let peer_process_id = peer_process_id(&stream)?;
    let (read_half, write_half) = stream.into_split();
    let mut reader = FrameReader::new(read_half, Direction::ClientToHost);
    let (control_sender, control_receiver) = mpsc::channel(CONTROL_QUEUE_CAPACITY);
    let (terminal_sender, terminal_receiver) = mpsc::channel(TERMINAL_QUEUE_CAPACITY);
    let outbound = Outbound {
        control: control_sender,
        terminal: terminal_sender,
        control_budget: Arc::new(Semaphore::new(CONTROL_BYTE_BUDGET)),
        terminal_budget: Arc::new(Semaphore::new(TERMINAL_BYTE_BUDGET)),
        sequence: Arc::new(AtomicU64::new(0)),
    };
    let writer = tokio::spawn(write_outbound(
        FrameWriter::new(write_half),
        control_receiver,
        terminal_receiver,
    ));
    let mut session = ConnectionSession::new_with_peer(actor.clone(), peer_process_id);
    let mut streams = HashMap::new();
    let mut state_subscription = None;
    while let Some(frame) = reader.read().await? {
        let should_close = match frame.kind {
            FrameKind::ClientControl => {
                receive_control(
                    &mut session,
                    &actor,
                    &outbound,
                    &mut streams,
                    &mut state_subscription,
                    &frame.payload,
                )
                .await?
            }
            FrameKind::TerminalInput => {
                receive_input(
                    &actor,
                    &streams,
                    session.client_id(),
                    frame.stream_id,
                    frame.payload,
                )
                .await?;
                false
            }
            FrameKind::HostControl | FrameKind::TerminalOutput | FrameKind::TerminalSnapshot => {
                true
            }
        };
        if should_close || session.is_closed() {
            break;
        }
    }
    let client_id = session.client_id();
    if let Some(subscription) = state_subscription {
        subscription.abort();
    }
    for (_, attachment) in streams {
        attachment.task.abort();
        if let Some(client_id) = client_id {
            let _ = actor
                .terminals()
                .detach(attachment.pane_id, client_id)
                .await;
        }
    }
    drop(outbound);
    writer
        .await
        .map_err(io::Error::other)?
        .map_err(io::Error::other)
}

async fn receive_control(
    session: &mut ConnectionSession,
    actor: &HostActor,
    outbound: &Outbound,
    streams: &mut HashMap<u32, StreamAttachment>,
    state_subscription: &mut Option<JoinHandle<()>>,
    payload: &[u8],
) -> io::Result<bool> {
    let control = match decode_client_control(payload) {
        Ok(control) => control,
        Err(decode_error) => {
            outbound
                .control(protocol_error(
                    None,
                    ProtocolErrorCode::InvalidRequest,
                    json!({"reason": decode_error.to_string()}),
                ))
                .await?;
            return Ok(false);
        }
    };
    let ClientControl::Request {
        command_id,
        method,
        params,
    } = control
    else {
        let response = session.receive(control).await;
        outbound.control(response).await?;
        return Ok(session.is_closed());
    };
    let Some(client_id) = session.client_id() else {
        let response = session
            .receive(ClientControl::Request {
                command_id,
                method,
                params,
            })
            .await;
        outbound.control(response).await?;
        return Ok(false);
    };
    match method.as_str() {
        "terminal.attach" => {
            let request = decode_request::<AttachRequest>(command_id, params)?;
            if request.stream_id == 0 || streams.contains_key(&request.stream_id) {
                outbound
                    .control(protocol_error(
                        Some(command_id),
                        ProtocolErrorCode::InvalidRequest,
                        json!({"stream_id": request.stream_id}),
                    ))
                    .await?;
                return Ok(false);
            }
            match actor.terminals().attach(request.pane_id, client_id).await {
                Ok(attachment) => {
                    outbound
                        .control(HostControl::Result {
                            command_id,
                            result: json!({"stream_id": request.stream_id}),
                        })
                        .await?;
                    let ready = Arc::new(AtomicBool::new(false));
                    let task = tokio::spawn(forward_attachment(
                        request.stream_id,
                        attachment,
                        ready.clone(),
                        outbound.clone(),
                    ));
                    streams.insert(
                        request.stream_id,
                        StreamAttachment {
                            pane_id: request.pane_id,
                            ready,
                            writer_generation: None,
                            task,
                        },
                    );
                }
                Err(error) => outbound.control(terminal_error(command_id, error)).await?,
            }
        }
        "terminal.detach" | "terminal.cancel" => {
            let request = decode_request::<StreamRequest>(command_id, params)?;
            let response = if let Some(attachment) = streams.remove(&request.stream_id) {
                attachment.task.abort();
                match actor
                    .terminals()
                    .detach(attachment.pane_id, client_id)
                    .await
                {
                    Ok(()) | Err(TerminalError::NotAttached) => HostControl::Result {
                        command_id,
                        result: Value::Null,
                    },
                    Err(error) => terminal_error(command_id, error),
                }
            } else {
                protocol_error(
                    Some(command_id),
                    ProtocolErrorCode::NotFound,
                    json!({"stream_id": request.stream_id}),
                )
            };
            outbound.control(response).await?;
        }
        "terminal.claim" => {
            let request = decode_request::<StreamRequest>(command_id, params)?;
            let response = if let Some(attachment) = streams.get_mut(&request.stream_id) {
                if !attachment.ready.load(Ordering::Acquire) {
                    protocol_error(
                        Some(command_id),
                        ProtocolErrorCode::InvalidRequest,
                        json!({"reason": "attachment_not_ready"}),
                    )
                } else {
                    match actor
                        .terminals()
                        .claim_writer(attachment.pane_id, client_id)
                        .await
                    {
                        Ok(generation) => {
                            attachment.writer_generation = Some(generation);
                            HostControl::Result {
                                command_id,
                                result: json!({"generation": generation}),
                            }
                        }
                        Err(error) => terminal_error(command_id, error),
                    }
                }
            } else {
                protocol_error(
                    Some(command_id),
                    ProtocolErrorCode::NotFound,
                    json!({"stream_id": request.stream_id}),
                )
            };
            outbound.control(response).await?;
        }
        "terminal.resize" => {
            let request = decode_request::<ResizeRequest>(command_id, params)?;
            let response = if let Some(attachment) = streams.get(&request.stream_id) {
                if let Some(generation) = attachment.writer_generation {
                    match actor
                        .terminals()
                        .resize(attachment.pane_id, client_id, generation, request.viewport)
                        .await
                    {
                        Ok(()) => HostControl::Result {
                            command_id,
                            result: Value::Null,
                        },
                        Err(error) => terminal_error(command_id, error),
                    }
                } else {
                    protocol_error(
                        Some(command_id),
                        ProtocolErrorCode::InvalidRequest,
                        json!({"reason": "writer_not_claimed"}),
                    )
                }
            } else {
                protocol_error(
                    Some(command_id),
                    ProtocolErrorCode::NotFound,
                    json!({"stream_id": request.stream_id}),
                )
            };
            outbound.control(response).await?;
        }
        _ => {
            let revision_receiver = (method == "state.subscribe").then(|| actor.revisions());
            let response = session
                .receive(ClientControl::Request {
                    command_id,
                    method,
                    params,
                })
                .await;
            let initial_subscription = match &response {
                HostControl::Result { result, .. } => revision_receiver
                    .as_ref()
                    .and_then(|_| serde_json::from_value::<Subscription>(result.clone()).ok()),
                _ => None,
            };
            outbound.control(response).await?;
            if let (Some(subscription), Some(revisions)) = (initial_subscription, revision_receiver)
            {
                if let Some(task) = state_subscription.take() {
                    task.abort();
                }
                *state_subscription = Some(tokio::spawn(forward_state(
                    actor.clone(),
                    client_id,
                    subscription_revision(&subscription),
                    revisions,
                    outbound.clone(),
                )));
            }
        }
    }
    Ok(false)
}

async fn forward_state(
    actor: HostActor,
    client_id: crate::protocol::control::ClientId,
    mut after_revision: u64,
    mut revisions: tokio::sync::watch::Receiver<u64>,
    outbound: Outbound,
) {
    while revisions.changed().await.is_ok() {
        let Ok(subscription) = actor.subscribe(client_id, Some(after_revision)).await else {
            break;
        };
        let Some(revision) = visible_subscription_revision(&subscription) else {
            continue;
        };
        after_revision = revision;
        if outbound
            .control(HostControl::State { subscription })
            .await
            .is_err()
        {
            break;
        }
    }
}

fn subscription_revision(subscription: &Subscription) -> u64 {
    visible_subscription_revision(subscription).unwrap_or(0)
}

fn visible_subscription_revision(subscription: &Subscription) -> Option<u64> {
    match subscription {
        Subscription::Snapshot(snapshot) => Some(snapshot.revision),
        Subscription::Replay(mutations) => mutations.last().map(|mutation| mutation.revision),
    }
}

async fn receive_input(
    actor: &HostActor,
    streams: &HashMap<u32, StreamAttachment>,
    client_id: Option<crate::protocol::control::ClientId>,
    stream_id: u32,
    payload: Bytes,
) -> io::Result<()> {
    let Some(attachment) = streams.get(&stream_id) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "terminal input used an unattached stream",
        ));
    };
    let Some(generation) = attachment.writer_generation else {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "terminal input used an observer stream",
        ));
    };
    let client_id = client_id.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "connection has no identity",
        )
    })?;
    actor
        .terminals()
        .input(attachment.pane_id, client_id, generation, payload.to_vec())
        .await
        .map_err(io::Error::other)
}

async fn forward_attachment(
    stream_id: u32,
    mut attachment: Attachment,
    ready: Arc<AtomicBool>,
    outbound: Outbound,
) {
    while let Some(event) = attachment.events.recv().await {
        let result = match event {
            OutputEvent::Attached {
                snapshot_id,
                boundary,
            } => {
                ready.store(false, Ordering::Release);
                outbound
                    .control(HostControl::Terminal {
                        stream_id,
                        event: TerminalControl::Attached {
                            snapshot_id,
                            boundary,
                        },
                    })
                    .await
            }
            OutputEvent::SnapshotBegin {
                snapshot_id,
                boundary,
                length,
            } => {
                outbound
                    .control(HostControl::Terminal {
                        stream_id,
                        event: TerminalControl::SnapshotBegin {
                            snapshot_id,
                            boundary,
                            encoding: SnapshotEncoding::GhosttyV1,
                            declared_length: length,
                            limit: MAXIMUM_SNAPSHOT_BYTES,
                        },
                    })
                    .await
            }
            OutputEvent::SnapshotChunk {
                snapshot_id,
                offset,
                bytes,
            } => {
                outbound
                    .terminal(Frame {
                        kind: FrameKind::TerminalSnapshot,
                        stream_id,
                        payload: encode_snapshot_chunk(snapshot_id, offset, &bytes),
                    })
                    .await
            }
            OutputEvent::SnapshotEnd {
                snapshot_id,
                length,
                sha256,
            } => {
                outbound
                    .control(HostControl::Terminal {
                        stream_id,
                        event: TerminalControl::SnapshotEnd {
                            snapshot_id,
                            total_length: length,
                            sha256,
                        },
                    })
                    .await
            }
            OutputEvent::Ready { next_sequence } => {
                let result = outbound
                    .control(HostControl::Terminal {
                        stream_id,
                        event: TerminalControl::Ready { next_sequence },
                    })
                    .await;
                if result.is_ok() {
                    ready.store(true, Ordering::Release);
                }
                result
            }
            OutputEvent::Output { sequence, bytes } => {
                send_output(&outbound, stream_id, sequence, &bytes).await
            }
            OutputEvent::Exited { code, signal } => {
                outbound
                    .control(HostControl::Terminal {
                        stream_id,
                        event: TerminalControl::Exited { code, signal },
                    })
                    .await
            }
        };
        if result.is_err() {
            break;
        }
    }
}

async fn send_output(
    outbound: &Outbound,
    stream_id: u32,
    sequence: u64,
    bytes: &[u8],
) -> io::Result<()> {
    let maximum = MAX_TERMINAL_PAYLOAD - OUTPUT_HEADER_LENGTH;
    let mut offset = 0;
    for chunk in bytes.chunks(maximum) {
        outbound
            .terminal(Frame {
                kind: FrameKind::TerminalOutput,
                stream_id,
                payload: encode_output(sequence + offset as u64, chunk),
            })
            .await?;
        offset += chunk.len();
    }
    Ok(())
}

async fn write_outbound(
    mut writer: FrameWriter<tokio::net::unix::OwnedWriteHalf>,
    mut control: mpsc::Receiver<QueuedFrame>,
    mut terminal: mpsc::Receiver<QueuedFrame>,
) -> io::Result<()> {
    let mut control_done = false;
    let mut terminal_done = false;
    let mut next_sequence = 0;
    let mut pending = BTreeMap::new();
    while !control_done || !terminal_done {
        tokio::select! {
            frame = control.recv(), if !control_done => {
                if let Some(queued) = frame {
                    pending.insert(queued.sequence, queued);
                } else {
                    control_done = true;
                }
            }
            frame = terminal.recv(), if !terminal_done => {
                if let Some(queued) = frame {
                    pending.insert(queued.sequence, queued);
                } else {
                    terminal_done = true;
                }
            }
        }
        while let Some(queued) = pending.remove(&next_sequence) {
            writer.write(&queued.frame).await?;
            next_sequence += 1;
        }
    }
    Ok(())
}

fn decode_request<T: for<'de> Deserialize<'de>>(
    command_id: CommandId,
    params: Value,
) -> io::Result<T> {
    serde_json::from_value(params).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid request {command_id}: {error}"),
        )
    })
}

#[derive(Deserialize)]
struct AttachRequest {
    pane_id: PaneId,
    stream_id: u32,
}

#[derive(Deserialize)]
struct StreamRequest {
    stream_id: u32,
}

#[derive(Deserialize)]
struct ResizeRequest {
    stream_id: u32,
    viewport: Viewport,
}

fn terminal_error(command_id: CommandId, error: TerminalError) -> HostControl {
    let code = match &error {
        TerminalError::NotFound => ProtocolErrorCode::NotFound,
        TerminalError::AlreadyExists | TerminalError::NotAttached | TerminalError::StaleWriter => {
            ProtocolErrorCode::InvalidRequest
        }
        TerminalError::Spawn(_)
        | TerminalError::InputTooLarge
        | TerminalError::InputQueueFull
        | TerminalError::Stopped
        | TerminalError::Pty(_)
        | TerminalError::State(_) => ProtocolErrorCode::Internal,
    };
    protocol_error(Some(command_id), code, json!({"reason": error.to_string()}))
}

fn protocol_error(
    command_id: Option<CommandId>,
    code: ProtocolErrorCode,
    details: Value,
) -> HostControl {
    HostControl::Error {
        command_id,
        error: ProtocolError {
            code,
            details,
            retryable: false,
        },
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut uid = 0;
    let mut gid = 0;
    let result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if result == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
pub fn peer_process_id(stream: &UnixStream) -> io::Result<Option<u32>> {
    let mut process_id = 0_i32;
    let mut length = std::mem::size_of::<i32>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&raw mut process_id).cast(),
            &raw mut length,
        )
    };
    if result == 0 {
        Ok(u32::try_from(process_id).ok())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
pub fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&raw mut credentials).cast(),
            &raw mut length,
        )
    };
    if result == 0 {
        Ok(credentials.uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
pub fn peer_process_id(stream: &UnixStream) -> io::Result<Option<u32>> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&raw mut credentials).cast(),
            &raw mut length,
        )
    };
    if result == 0 {
        Ok(u32::try_from(credentials.pid).ok())
    } else {
        Err(io::Error::last_os_error())
    }
}
