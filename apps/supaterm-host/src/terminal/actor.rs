use crate::protocol::control::ClientId;
use crate::protocol::terminal::PaneId;
use crate::terminal::pty::{
    Pty, PtyWriter, SpawnError, SpawnSpec, TerminalEnvironment, signal_process_group,
};
use crate::terminal::vt::{TerminalEffect, TerminalProgressState, TerminalViewport};
use crate::terminal::vt_worker::VtHandle;
use crate::workspace::runtime::{ProgressReport, ProgressState};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::os::unix::process::ExitStatusExt;
use std::process::ExitStatus;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use uuid::Uuid;

const PANE_QUEUE_CAPACITY: usize = 256;
const ATTACHMENT_QUEUE_CAPACITY: usize = 64;
const INPUT_QUEUE_CAPACITY: usize = 256;
const MAXIMUM_INPUT_BYTES: usize = 64 * 1024;
const SNAPSHOT_CHUNK_BYTES: usize = 64 * 1024 - 24;
const MAXIMUM_CATCHUP_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PaneInfo {
    pub id: PaneId,
    pub pid: u32,
    pub output_sequence: u64,
    pub attachment_count: usize,
    pub writer: Option<ClientId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OutputEvent {
    Attached {
        snapshot_id: Uuid,
        boundary: u64,
    },
    SnapshotBegin {
        snapshot_id: Uuid,
        boundary: u64,
        length: u64,
    },
    SnapshotChunk {
        snapshot_id: Uuid,
        offset: u64,
        bytes: Bytes,
    },
    SnapshotEnd {
        snapshot_id: Uuid,
        length: u64,
        sha256: [u8; 32],
    },
    Ready {
        next_sequence: u64,
    },
    Output {
        sequence: u64,
        bytes: Bytes,
    },
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

pub struct Attachment {
    pub events: mpsc::Receiver<OutputEvent>,
    pub next_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalRuntimeEvent {
    FactsChanged {
        pane_id: PaneId,
        title: Option<Option<String>>,
        current_directory: Option<Option<std::path::PathBuf>>,
        progress: Option<Option<ProgressReport>>,
    },
    ProcessGroupObserved {
        pane_id: PaneId,
        process_group_id: Option<u32>,
    },
    Bell {
        pane_id: PaneId,
    },
    DesktopNotification {
        pane_id: PaneId,
        title: Option<String>,
        body: String,
    },
    ScreenChanged {
        pane_id: PaneId,
        source_revision: u64,
        text: String,
    },
    Exited {
        pane_id: PaneId,
        code: Option<i32>,
        signal: Option<i32>,
    },
}

#[derive(Debug, Error)]
pub enum TerminalError {
    #[error(transparent)]
    Spawn(#[from] SpawnError),
    #[error("pane not found")]
    NotFound,
    #[error("pane already exists")]
    AlreadyExists,
    #[error("client is not attached")]
    NotAttached,
    #[error("writer generation is stale")]
    StaleWriter,
    #[error("terminal input exceeds 64 KiB")]
    InputTooLarge,
    #[error("terminal input queue is full")]
    InputQueueFull,
    #[error("pane actor stopped")]
    Stopped,
    #[error("PTY operation failed: {0}")]
    Pty(String),
    #[error("terminal state failed: {0}")]
    State(String),
}

#[derive(Clone)]
pub struct TerminalRegistry {
    sender: mpsc::Sender<RegistryMessage>,
}

impl TerminalRegistry {
    pub fn spawn() -> Self {
        let (registry, mut events) = Self::spawn_with_events(None);
        tokio::spawn(async move { while events.recv().await.is_some() {} });
        registry
    }

    pub fn spawn_with_events(
        terminal_environment: Option<TerminalEnvironment>,
    ) -> (Self, mpsc::Receiver<TerminalRuntimeEvent>) {
        let (sender, receiver) = mpsc::channel(PANE_QUEUE_CAPACITY);
        let (exit_sender, exit_receiver) = mpsc::channel(PANE_QUEUE_CAPACITY);
        let (event_sender, event_receiver) = mpsc::channel(PANE_QUEUE_CAPACITY);
        tokio::spawn(run_registry(
            receiver,
            exit_receiver,
            exit_sender,
            event_sender.clone(),
            terminal_environment,
        ));
        (Self { sender }, event_receiver)
    }

    pub async fn create(&self, spec: SpawnSpec) -> Result<PaneInfo, TerminalError> {
        self.create_with_id(PaneId(Uuid::new_v4()), spec).await
    }

    pub async fn create_with_id(
        &self,
        pane_id: PaneId,
        spec: SpawnSpec,
    ) -> Result<PaneInfo, TerminalError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(RegistryMessage::Create {
                pane_id,
                spec,
                reply,
            })
            .await
            .map_err(|_| TerminalError::Stopped)?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }

    pub async fn list(&self) -> Result<Vec<PaneInfo>, TerminalError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(RegistryMessage::List { reply })
            .await
            .map_err(|_| TerminalError::Stopped)?;
        response.await.map_err(|_| TerminalError::Stopped)
    }

    pub async fn info(&self, pane_id: PaneId) -> Result<PaneInfo, TerminalError> {
        self.handle(pane_id).await?.info().await
    }

    pub async fn attach(
        &self,
        pane_id: PaneId,
        client_id: ClientId,
    ) -> Result<Attachment, TerminalError> {
        self.handle(pane_id).await?.attach(client_id).await
    }

    pub async fn detach(&self, pane_id: PaneId, client_id: ClientId) -> Result<(), TerminalError> {
        self.handle(pane_id).await?.detach(client_id).await
    }

    pub async fn claim_writer(
        &self,
        pane_id: PaneId,
        client_id: ClientId,
    ) -> Result<u64, TerminalError> {
        self.handle(pane_id).await?.claim_writer(client_id).await
    }

    pub async fn input(
        &self,
        pane_id: PaneId,
        client_id: ClientId,
        generation: u64,
        bytes: Vec<u8>,
    ) -> Result<(), TerminalError> {
        self.handle(pane_id)
            .await?
            .input(client_id, generation, bytes)
            .await
    }

    pub async fn resize(
        &self,
        pane_id: PaneId,
        client_id: ClientId,
        generation: u64,
        viewport: Viewport,
    ) -> Result<(), TerminalError> {
        self.handle(pane_id)
            .await?
            .resize(client_id, generation, viewport)
            .await
    }

    pub async fn close(&self, pane_id: PaneId) -> Result<(), TerminalError> {
        self.handle(pane_id).await?.close().await
    }

    pub async fn shutdown(&self) -> Result<(), TerminalError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(RegistryMessage::Shutdown { reply })
            .await
            .map_err(|_| TerminalError::Stopped)?;
        response.await.map_err(|_| TerminalError::Stopped)
    }

    async fn handle(&self, pane_id: PaneId) -> Result<PaneHandle, TerminalError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(RegistryMessage::Handle { pane_id, reply })
            .await
            .map_err(|_| TerminalError::Stopped)?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Viewport {
    pub rows: u16,
    pub columns: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

impl Viewport {
    fn terminal(self) -> TerminalViewport {
        TerminalViewport {
            rows: self.rows,
            columns: self.columns,
            cell_width: u32::from(self.pixel_width) / u32::from(self.columns.max(1)),
            cell_height: u32::from(self.pixel_height) / u32::from(self.rows.max(1)),
        }
    }
}

impl From<&SpawnSpec> for Viewport {
    fn from(spec: &SpawnSpec) -> Self {
        Self {
            rows: spec.rows,
            columns: spec.columns,
            pixel_width: spec.pixel_width,
            pixel_height: spec.pixel_height,
        }
    }
}

enum RegistryMessage {
    Create {
        pane_id: PaneId,
        spec: SpawnSpec,
        reply: oneshot::Sender<Result<PaneInfo, TerminalError>>,
    },
    List {
        reply: oneshot::Sender<Vec<PaneInfo>>,
    },
    Handle {
        pane_id: PaneId,
        reply: oneshot::Sender<Result<PaneHandle, TerminalError>>,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}

async fn run_registry(
    mut receiver: mpsc::Receiver<RegistryMessage>,
    mut exits: mpsc::Receiver<RuntimeExit>,
    exit_sender: mpsc::Sender<RuntimeExit>,
    event_sender: mpsc::Sender<TerminalRuntimeEvent>,
    terminal_environment: Option<TerminalEnvironment>,
) {
    let mut panes = HashMap::new();
    loop {
        tokio::select! {
            message = receiver.recv() => {
                let Some(message) = message else { break };
                match message {
                    RegistryMessage::Create { pane_id, spec, reply } => {
                        if panes.contains_key(&pane_id) {
                            let _ = reply.send(Err(TerminalError::AlreadyExists));
                            continue;
                        }
                        match PaneRuntime::prepare(
                            pane_id,
                            spec,
                            exit_sender.clone(),
                            event_sender.clone(),
                            terminal_environment.as_ref(),
                        ) {
                            Ok((runtime, handle, info)) => {
                                panes.insert(pane_id, handle);
                                tokio::spawn(runtime.run());
                                let _ = reply.send(Ok(info));
                            }
                            Err(error) => {
                                let _ = reply.send(Err(error));
                            }
                        }
                    }
                    RegistryMessage::List { reply } => {
                        let handles: Vec<_> = panes.values().cloned().collect();
                        let mut result = Vec::with_capacity(handles.len());
                        for handle in handles {
                            if let Ok(info) = handle.info().await {
                                result.push(info);
                            }
                        }
                        let _ = reply.send(result);
                    }
                    RegistryMessage::Handle { pane_id, reply } => {
                        let _ = reply.send(panes.get(&pane_id).cloned().ok_or(TerminalError::NotFound));
                    }
                    RegistryMessage::Shutdown { reply } => {
                        let handles = std::mem::take(&mut panes);
                        for handle in handles.into_values() {
                            let _ = handle.close().await;
                        }
                        let _ = reply.send(());
                        break;
                    }
                }
            }
            exited = exits.recv() => {
                let Some(exited) = exited else { break };
                panes.remove(&exited.pane_id);
                let _ = event_sender.send(TerminalRuntimeEvent::Exited {
                    pane_id: exited.pane_id,
                    code: exited.code,
                    signal: exited.signal,
                }).await;
            }
        }
    }
    for handle in panes.into_values() {
        let _ = handle.close().await;
    }
}

struct RuntimeExit {
    pane_id: PaneId,
    code: Option<i32>,
    signal: Option<i32>,
}

#[derive(Clone)]
struct PaneHandle {
    sender: mpsc::Sender<PaneMessage>,
}

impl PaneHandle {
    async fn info(&self) -> Result<PaneInfo, TerminalError> {
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::Info { reply }).await?;
        response.await.map_err(|_| TerminalError::Stopped)
    }

    async fn attach(&self, client_id: ClientId) -> Result<Attachment, TerminalError> {
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::Attach { client_id, reply }).await?;
        response.await.map_err(|_| TerminalError::Stopped)
    }

    async fn detach(&self, client_id: ClientId) -> Result<(), TerminalError> {
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::Detach { client_id, reply }).await?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }

    async fn claim_writer(&self, client_id: ClientId) -> Result<u64, TerminalError> {
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::ClaimWriter { client_id, reply })
            .await?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }

    async fn input(
        &self,
        client_id: ClientId,
        generation: u64,
        bytes: Vec<u8>,
    ) -> Result<(), TerminalError> {
        if bytes.len() > MAXIMUM_INPUT_BYTES {
            return Err(TerminalError::InputTooLarge);
        }
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::Input {
            client_id,
            generation,
            bytes: Bytes::from(bytes),
            reply,
        })
        .await?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }

    async fn resize(
        &self,
        client_id: ClientId,
        generation: u64,
        viewport: Viewport,
    ) -> Result<(), TerminalError> {
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::Resize {
            client_id,
            generation,
            viewport,
            reply,
        })
        .await?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }

    async fn close(&self) -> Result<(), TerminalError> {
        let (reply, response) = oneshot::channel();
        self.send(PaneMessage::Close { reply }).await?;
        response.await.map_err(|_| TerminalError::Stopped)?
    }

    async fn send(&self, message: PaneMessage) -> Result<(), TerminalError> {
        self.sender
            .send(message)
            .await
            .map_err(|_| TerminalError::Stopped)
    }
}

enum PaneMessage {
    Info {
        reply: oneshot::Sender<PaneInfo>,
    },
    Attach {
        client_id: ClientId,
        reply: oneshot::Sender<Attachment>,
    },
    Detach {
        client_id: ClientId,
        reply: oneshot::Sender<Result<(), TerminalError>>,
    },
    ClaimWriter {
        client_id: ClientId,
        reply: oneshot::Sender<Result<u64, TerminalError>>,
    },
    Input {
        client_id: ClientId,
        generation: u64,
        bytes: Bytes,
        reply: oneshot::Sender<Result<(), TerminalError>>,
    },
    Resize {
        client_id: ClientId,
        generation: u64,
        viewport: Viewport,
        reply: oneshot::Sender<Result<(), TerminalError>>,
    },
    Close {
        reply: oneshot::Sender<Result<(), TerminalError>>,
    },
    SnapshotReady {
        client_id: ClientId,
        snapshot_id: Uuid,
        boundary: u64,
        result: Result<Vec<u8>, String>,
    },
    SnapshotDelivered {
        client_id: ClientId,
        snapshot_id: Uuid,
        delivered: bool,
    },
    FlushDelivered {
        client_id: ClientId,
        snapshot_id: Uuid,
        delivered: bool,
    },
    ScreenCaptured {
        source_revision: u64,
        result: Result<String, String>,
    },
    Escalate,
    ChildExited(ExitStatus),
}

struct AttachmentState {
    sender: mpsc::Sender<OutputEvent>,
    phase: AttachmentPhase,
    resnapshot_count: u8,
}

enum AttachmentPhase {
    Ready,
    Snapshotting(PendingAttachment),
    Flushing(PendingAttachment),
}

struct PendingAttachment {
    snapshot_id: Uuid,
    boundary: u64,
    buffered: Vec<OutputEvent>,
    buffered_bytes: usize,
    announce: bool,
    producer: Option<JoinHandle<()>>,
}

impl PendingAttachment {
    fn new(snapshot_id: Uuid, boundary: u64, announce: bool) -> Self {
        Self {
            snapshot_id,
            boundary,
            buffered: Vec::new(),
            buffered_bytes: 0,
            announce,
            producer: None,
        }
    }

    fn push(&mut self, event: OutputEvent) -> bool {
        if let OutputEvent::Output { bytes, .. } = &event {
            self.buffered_bytes = self.buffered_bytes.saturating_add(bytes.len());
        }
        self.buffered.push(event);
        self.buffered_bytes > MAXIMUM_CATCHUP_BYTES
    }
}

struct PaneRuntime {
    id: PaneId,
    pty: Pty,
    vt: VtHandle,
    receiver: mpsc::Receiver<PaneMessage>,
    sender: mpsc::Sender<PaneMessage>,
    input: mpsc::Sender<Bytes>,
    exit_sender: mpsc::Sender<RuntimeExit>,
    event_sender: mpsc::Sender<TerminalRuntimeEvent>,
    attachments: HashMap<ClientId, AttachmentState>,
    writer: Option<(ClientId, u64)>,
    next_writer_generation: u64,
    output_sequence: u64,
    screen_dirty: bool,
    screen_capture_running: bool,
    closing: bool,
    close_replies: Vec<oneshot::Sender<Result<(), TerminalError>>>,
    exit_status: Option<(Option<i32>, Option<i32>)>,
}

impl PaneRuntime {
    fn prepare(
        id: PaneId,
        spec: SpawnSpec,
        exit_sender: mpsc::Sender<RuntimeExit>,
        event_sender: mpsc::Sender<TerminalRuntimeEvent>,
        terminal_environment: Option<&TerminalEnvironment>,
    ) -> Result<(Self, PaneHandle, PaneInfo), TerminalError> {
        let vt = VtHandle::spawn(Viewport::from(&spec).terminal())
            .map_err(|error| TerminalError::State(error.to_string()))?;
        let (pty, mut child) = Pty::spawn_with_environment(&spec, Some(id), terminal_environment)?;
        let writer = pty
            .writer()
            .map_err(|error| TerminalError::Pty(error.to_string()))?;
        let (sender, receiver) = mpsc::channel(PANE_QUEUE_CAPACITY);
        let (input, input_receiver) = mpsc::channel(INPUT_QUEUE_CAPACITY);
        tokio::spawn(run_input_writer(writer, input_receiver));
        let child_sender = sender.clone();
        tokio::task::spawn_blocking(move || child.wait()).then_send(child_sender);
        let runtime = Self {
            id,
            pty,
            vt,
            receiver,
            sender: sender.clone(),
            input,
            exit_sender,
            event_sender,
            attachments: HashMap::new(),
            writer: None,
            next_writer_generation: 1,
            output_sequence: 0,
            screen_dirty: false,
            screen_capture_running: false,
            closing: false,
            close_replies: Vec::new(),
            exit_status: None,
        };
        let info = runtime.info();
        Ok((runtime, PaneHandle { sender }, info))
    }

    async fn run(mut self) {
        let mut buffer = vec![0_u8; MAXIMUM_INPUT_BYTES];
        let mut reading = true;
        let mut process_observer = tokio::time::interval(Duration::from_secs(2));
        process_observer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut screen_observer = tokio::time::interval(Duration::from_millis(300));
        screen_observer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = process_observer.tick() => {
                    let process_group_id = self.pty.foreground_process_group().unwrap_or(None);
                    let _ = self.event_sender.send(TerminalRuntimeEvent::ProcessGroupObserved {
                        pane_id: self.id,
                        process_group_id,
                    }).await;
                }
                _ = screen_observer.tick(), if self.screen_dirty && !self.screen_capture_running => {
                    self.request_screen_capture();
                }
                result = self.pty.read(&mut buffer), if reading => {
                    match result {
                        Ok(0) | Err(_) => reading = false,
                        Ok(count) => {
                            let bytes = Bytes::copy_from_slice(&buffer[..count]);
                            if self.publish(bytes).await.is_err() {
                                reading = false;
                                let _ = self.pty.terminate_process_group();
                            }
                        }
                    }
                }
                message = self.receiver.recv() => {
                    let Some(message) = message else {
                        let _ = self.pty.terminate_process_group();
                        break;
                    };
                    if self.handle(message).await {
                        break;
                    }
                }
            }
        }
        let (code, signal) = self.exit_status.unwrap_or((None, None));
        let _ = self
            .exit_sender
            .send(RuntimeExit {
                pane_id: self.id,
                code,
                signal,
            })
            .await;
    }

    async fn handle(&mut self, message: PaneMessage) -> bool {
        match message {
            PaneMessage::Info { reply } => {
                let _ = reply.send(self.info());
            }
            PaneMessage::Attach { client_id, reply } => self.attach(client_id, reply),
            PaneMessage::Detach { client_id, reply } => {
                let existed = self.remove_attachment(client_id);
                let _ = reply.send(if existed {
                    Ok(())
                } else {
                    Err(TerminalError::NotAttached)
                });
            }
            PaneMessage::ClaimWriter { client_id, reply } => {
                if !self.attachments.contains_key(&client_id) {
                    let _ = reply.send(Err(TerminalError::NotAttached));
                } else {
                    let generation = self.next_writer_generation;
                    self.next_writer_generation =
                        self.next_writer_generation.wrapping_add(1).max(1);
                    self.writer = Some((client_id, generation));
                    let _ = reply.send(Ok(generation));
                }
            }
            PaneMessage::Input {
                client_id,
                generation,
                bytes,
                reply,
            } => {
                let result = if self.writer != Some((client_id, generation)) {
                    Err(TerminalError::StaleWriter)
                } else {
                    self.input
                        .try_send(bytes)
                        .map_err(|_| TerminalError::InputQueueFull)
                };
                let _ = reply.send(result);
            }
            PaneMessage::Resize {
                client_id,
                generation,
                viewport,
                reply,
            } => {
                let result = self.resize(client_id, generation, viewport).await;
                let _ = reply.send(result);
            }
            PaneMessage::Close { reply } => {
                self.close_replies.push(reply);
                if !self.closing {
                    self.closing = true;
                    let _ = self.pty.terminate_process_group();
                    let sender = self.sender.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        let _ = sender.send(PaneMessage::Escalate).await;
                    });
                }
            }
            PaneMessage::SnapshotReady {
                client_id,
                snapshot_id,
                boundary,
                result,
            } => self.snapshot_ready(client_id, snapshot_id, boundary, result),
            PaneMessage::SnapshotDelivered {
                client_id,
                snapshot_id,
                delivered,
            } => self.snapshot_delivered(client_id, snapshot_id, delivered),
            PaneMessage::FlushDelivered {
                client_id,
                snapshot_id,
                delivered,
            } => self.flush_delivered(client_id, snapshot_id, delivered),
            PaneMessage::ScreenCaptured {
                source_revision,
                result,
            } => {
                self.screen_capture_running = false;
                if let Ok(text) = result {
                    let _ = self
                        .event_sender
                        .send(TerminalRuntimeEvent::ScreenChanged {
                            pane_id: self.id,
                            source_revision,
                            text,
                        })
                        .await;
                }
            }
            PaneMessage::Escalate => {
                let _ = signal_process_group(self.pty.pid(), libc::SIGKILL);
            }
            PaneMessage::ChildExited(status) => {
                self.exit_status = Some((status.code(), status.signal()));
                let event = OutputEvent::Exited {
                    code: status.code(),
                    signal: status.signal(),
                };
                self.attachments
                    .retain(|_, attachment| attachment.sender.try_send(event.clone()).is_ok());
                for reply in self.close_replies.drain(..) {
                    let _ = reply.send(Ok(()));
                }
                return true;
            }
        }
        false
    }

    fn attach(&mut self, client_id: ClientId, reply: oneshot::Sender<Attachment>) {
        self.remove_attachment(client_id);
        let (sender, events) = mpsc::channel(ATTACHMENT_QUEUE_CAPACITY);
        let boundary = self.output_sequence;
        let snapshot_id = Uuid::new_v4();
        let _ = sender.try_send(OutputEvent::Attached {
            snapshot_id,
            boundary,
        });
        self.attachments.insert(
            client_id,
            AttachmentState {
                sender,
                phase: AttachmentPhase::Snapshotting(PendingAttachment::new(
                    snapshot_id,
                    boundary,
                    false,
                )),
                resnapshot_count: 0,
            },
        );
        self.request_snapshot(client_id, snapshot_id, boundary);
        let _ = reply.send(Attachment {
            events,
            next_sequence: boundary,
        });
    }

    async fn resize(
        &mut self,
        client_id: ClientId,
        generation: u64,
        viewport: Viewport,
    ) -> Result<(), TerminalError> {
        if self.writer != Some((client_id, generation)) {
            return Err(TerminalError::StaleWriter);
        }
        self.pty
            .resize(
                viewport.rows,
                viewport.columns,
                viewport.pixel_width,
                viewport.pixel_height,
            )
            .map_err(|error| TerminalError::Pty(error.to_string()))?;
        let replies = self
            .vt
            .resize(viewport.terminal())
            .await
            .map_err(|error| TerminalError::State(error.to_string()))?;
        self.queue_replies(replies)
    }

    async fn publish(&mut self, bytes: Bytes) -> Result<(), TerminalError> {
        let write = self
            .vt
            .write(bytes.clone())
            .await
            .map_err(|error| TerminalError::State(error.to_string()))?;
        self.queue_replies(write.replies)?;
        self.publish_effects(write.effects).await?;
        let sequence = self.output_sequence;
        self.output_sequence = self.output_sequence.saturating_add(bytes.len() as u64);
        self.screen_dirty = true;
        let event = OutputEvent::Output { sequence, bytes };
        let mut restart = Vec::new();
        let mut detach = Vec::new();
        for (client_id, attachment) in &mut self.attachments {
            match &mut attachment.phase {
                AttachmentPhase::Ready => {
                    if attachment.sender.try_send(event.clone()).is_err() {
                        if attachment.resnapshot_count == 0 {
                            restart.push(*client_id);
                        } else {
                            detach.push(*client_id);
                        }
                    }
                }
                AttachmentPhase::Snapshotting(pending) | AttachmentPhase::Flushing(pending) => {
                    if pending.push(event.clone()) {
                        if attachment.resnapshot_count == 0 {
                            restart.push(*client_id);
                        } else {
                            detach.push(*client_id);
                        }
                    }
                }
            }
        }
        for client_id in restart {
            if !self.restart_snapshot(client_id) {
                detach.push(client_id);
            }
        }
        for client_id in detach {
            self.remove_attachment(client_id);
        }
        Ok(())
    }

    fn request_screen_capture(&mut self) {
        self.screen_dirty = false;
        self.screen_capture_running = true;
        let source_revision = self.output_sequence;
        let vt = self.vt.clone();
        let sender = self.sender.clone();
        tokio::spawn(async move {
            let result = vt.plain_text().await.map_err(|error| error.to_string());
            let _ = sender
                .send(PaneMessage::ScreenCaptured {
                    source_revision,
                    result,
                })
                .await;
        });
    }

    async fn publish_effects(&self, effects: Vec<TerminalEffect>) -> Result<(), TerminalError> {
        let mut title = None;
        let mut current_directory = None;
        let mut progress = None;
        for effect in effects {
            match effect {
                TerminalEffect::Bell => {
                    self.event_sender
                        .send(TerminalRuntimeEvent::Bell { pane_id: self.id })
                        .await
                        .map_err(|_| TerminalError::Stopped)?;
                }
                TerminalEffect::Title(value) => title = Some(value),
                TerminalEffect::WorkingDirectory(value) => {
                    current_directory = Some(value.and_then(|value| working_directory(&value)))
                }
                TerminalEffect::Progress(value) => {
                    progress = Some(value.map(|value| ProgressReport {
                        state: match value.state {
                            TerminalProgressState::Set => ProgressState::Set,
                            TerminalProgressState::Error => ProgressState::Error,
                            TerminalProgressState::Indeterminate => ProgressState::Indeterminate,
                            TerminalProgressState::Paused => ProgressState::Paused,
                        },
                        percent: value.percent,
                    }))
                }
                TerminalEffect::DesktopNotification { title, body } => {
                    self.event_sender
                        .send(TerminalRuntimeEvent::DesktopNotification {
                            pane_id: self.id,
                            title,
                            body,
                        })
                        .await
                        .map_err(|_| TerminalError::Stopped)?;
                }
            }
        }
        if title.is_none() && current_directory.is_none() && progress.is_none() {
            return Ok(());
        }
        self.event_sender
            .send(TerminalRuntimeEvent::FactsChanged {
                pane_id: self.id,
                title,
                current_directory,
                progress,
            })
            .await
            .map_err(|_| TerminalError::Stopped)
    }

    fn queue_replies(&self, replies: Vec<Bytes>) -> Result<(), TerminalError> {
        for reply in replies {
            self.input
                .try_send(reply)
                .map_err(|_| TerminalError::InputQueueFull)?;
        }
        Ok(())
    }

    fn request_snapshot(&self, client_id: ClientId, snapshot_id: Uuid, boundary: u64) {
        let vt = self.vt.clone();
        let sender = self.sender.clone();
        tokio::spawn(async move {
            let result = vt.snapshot().await.map_err(|error| error.to_string());
            let _ = sender
                .send(PaneMessage::SnapshotReady {
                    client_id,
                    snapshot_id,
                    boundary,
                    result,
                })
                .await;
        });
    }

    fn restart_snapshot(&mut self, client_id: ClientId) -> bool {
        let boundary = self.output_sequence;
        let snapshot_id = Uuid::new_v4();
        let Some(attachment) = self.attachments.get_mut(&client_id) else {
            return false;
        };
        if attachment.resnapshot_count > 0 {
            return false;
        }
        match &mut attachment.phase {
            AttachmentPhase::Ready => {}
            AttachmentPhase::Snapshotting(pending) | AttachmentPhase::Flushing(pending) => {
                if let Some(producer) = pending.producer.take() {
                    producer.abort();
                }
            }
        }
        attachment.resnapshot_count = 1;
        attachment.phase =
            AttachmentPhase::Snapshotting(PendingAttachment::new(snapshot_id, boundary, true));
        self.request_snapshot(client_id, snapshot_id, boundary);
        true
    }

    fn snapshot_ready(
        &mut self,
        client_id: ClientId,
        snapshot_id: Uuid,
        boundary: u64,
        result: Result<Vec<u8>, String>,
    ) {
        let Ok(snapshot) = result else {
            self.remove_attachment(client_id);
            return;
        };
        let Some(attachment) = self.attachments.get_mut(&client_id) else {
            return;
        };
        let AttachmentPhase::Snapshotting(pending) = &mut attachment.phase else {
            return;
        };
        if pending.snapshot_id != snapshot_id || pending.boundary != boundary {
            return;
        }
        let sender = attachment.sender.clone();
        let actor = self.sender.clone();
        let announce = pending.announce;
        pending.producer = Some(tokio::spawn(async move {
            let delivered = send_snapshot(sender, snapshot_id, boundary, snapshot, announce).await;
            let _ = actor
                .send(PaneMessage::SnapshotDelivered {
                    client_id,
                    snapshot_id,
                    delivered,
                })
                .await;
        }));
    }

    fn snapshot_delivered(&mut self, client_id: ClientId, snapshot_id: Uuid, delivered: bool) {
        if !delivered {
            self.remove_attachment(client_id);
            return;
        }
        let Some(attachment) = self.attachments.get_mut(&client_id) else {
            return;
        };
        let phase = std::mem::replace(&mut attachment.phase, AttachmentPhase::Ready);
        let AttachmentPhase::Snapshotting(mut pending) = phase else {
            attachment.phase = phase;
            return;
        };
        if pending.snapshot_id != snapshot_id {
            attachment.phase = AttachmentPhase::Snapshotting(pending);
            return;
        }
        let batch = std::mem::take(&mut pending.buffered);
        pending.buffered_bytes = 0;
        pending.producer = Some(spawn_flush(
            attachment.sender.clone(),
            self.sender.clone(),
            client_id,
            snapshot_id,
            Some(pending.boundary),
            batch,
        ));
        attachment.phase = AttachmentPhase::Flushing(pending);
    }

    fn flush_delivered(&mut self, client_id: ClientId, snapshot_id: Uuid, delivered: bool) {
        if !delivered {
            self.remove_attachment(client_id);
            return;
        }
        let Some(attachment) = self.attachments.get_mut(&client_id) else {
            return;
        };
        let phase = std::mem::replace(&mut attachment.phase, AttachmentPhase::Ready);
        let AttachmentPhase::Flushing(mut pending) = phase else {
            attachment.phase = phase;
            return;
        };
        if pending.snapshot_id != snapshot_id {
            attachment.phase = AttachmentPhase::Flushing(pending);
            return;
        }
        if pending.buffered.is_empty() {
            return;
        }
        let batch = std::mem::take(&mut pending.buffered);
        pending.buffered_bytes = 0;
        pending.producer = Some(spawn_flush(
            attachment.sender.clone(),
            self.sender.clone(),
            client_id,
            snapshot_id,
            None,
            batch,
        ));
        attachment.phase = AttachmentPhase::Flushing(pending);
    }

    fn remove_attachment(&mut self, client_id: ClientId) -> bool {
        let Some(mut attachment) = self.attachments.remove(&client_id) else {
            return false;
        };
        match &mut attachment.phase {
            AttachmentPhase::Snapshotting(pending) | AttachmentPhase::Flushing(pending) => {
                if let Some(producer) = pending.producer.take() {
                    producer.abort();
                }
            }
            AttachmentPhase::Ready => {}
        }
        if self.writer.is_some_and(|(writer, _)| writer == client_id) {
            self.writer = None;
        }
        true
    }

    fn info(&self) -> PaneInfo {
        PaneInfo {
            id: self.id,
            pid: self.pty.pid(),
            output_sequence: self.output_sequence,
            attachment_count: self.attachments.len(),
            writer: self.writer.map(|(client_id, _)| client_id),
        }
    }
}

fn working_directory(value: &str) -> Option<std::path::PathBuf> {
    let encoded = if let Some(value) = value.strip_prefix("file://") {
        if value.starts_with('/') {
            value
        } else {
            value.find('/').map(|index| &value[index..])?
        }
    } else {
        value
    };
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2]))
        {
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let path = std::path::PathBuf::from(String::from_utf8(decoded).ok()?);
    path.is_absolute().then_some(path)
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

async fn send_snapshot(
    sender: mpsc::Sender<OutputEvent>,
    snapshot_id: Uuid,
    boundary: u64,
    snapshot: Vec<u8>,
    announce: bool,
) -> bool {
    if announce
        && sender
            .send(OutputEvent::Attached {
                snapshot_id,
                boundary,
            })
            .await
            .is_err()
    {
        return false;
    }
    let length = snapshot.len() as u64;
    if sender
        .send(OutputEvent::SnapshotBegin {
            snapshot_id,
            boundary,
            length,
        })
        .await
        .is_err()
    {
        return false;
    }
    for (index, bytes) in snapshot.chunks(SNAPSHOT_CHUNK_BYTES).enumerate() {
        if sender
            .send(OutputEvent::SnapshotChunk {
                snapshot_id,
                offset: (index * SNAPSHOT_CHUNK_BYTES) as u64,
                bytes: Bytes::copy_from_slice(bytes),
            })
            .await
            .is_err()
        {
            return false;
        }
    }
    let sha256 = Sha256::digest(&snapshot).into();
    sender
        .send(OutputEvent::SnapshotEnd {
            snapshot_id,
            length,
            sha256,
        })
        .await
        .is_ok()
}

fn spawn_flush(
    sender: mpsc::Sender<OutputEvent>,
    actor: mpsc::Sender<PaneMessage>,
    client_id: ClientId,
    snapshot_id: Uuid,
    ready: Option<u64>,
    batch: Vec<OutputEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut delivered = true;
        if let Some(next_sequence) = ready {
            delivered = sender
                .send(OutputEvent::Ready { next_sequence })
                .await
                .is_ok();
        }
        for event in batch {
            if !delivered || sender.send(event).await.is_err() {
                delivered = false;
                break;
            }
        }
        let _ = actor
            .send(PaneMessage::FlushDelivered {
                client_id,
                snapshot_id,
                delivered,
            })
            .await;
    })
}

trait ChildWaitTask {
    fn then_send(self, sender: mpsc::Sender<PaneMessage>);
}

impl ChildWaitTask for JoinHandle<std::io::Result<ExitStatus>> {
    fn then_send(self, sender: mpsc::Sender<PaneMessage>) {
        tokio::spawn(async move {
            if let Ok(Ok(status)) = self.await {
                let _ = sender.send(PaneMessage::ChildExited(status)).await;
            }
        });
    }
}

async fn run_input_writer(writer: PtyWriter, mut receiver: mpsc::Receiver<Bytes>) {
    while let Some(bytes) = receiver.recv().await {
        if writer.write_all(&bytes).await.is_err() {
            break;
        }
    }
}
