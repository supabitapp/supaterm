use crate::protocol::control::{
    BuildIdentity, ClientControl, ClientId, ClientRole, CommandId, HostControl, Limits,
    PROTOCOL_VERSION, decode_host_control, encode_control,
};
use crate::protocol::frame::{Direction, Frame, FrameKind, MAX_TERMINAL_PAYLOAD};
use crate::protocol::io::{FrameReader, FrameWriter};
use crate::protocol::terminal::{PaneId, TerminalControl, decode_output, decode_snapshot_chunk};
use crate::terminal::actor::{PaneInfo, Viewport};
use crate::terminal::pty::SpawnSpec;
use crate::workspace::model::{Placement, RootPlacement, TabId};
use crate::workspace::reducer::Command;
use crate::workspace::replay::{ApplyResult, ModelSnapshot, Subscription};
use bytes::Bytes;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::UnixStream;
use tokio::sync::{Mutex, mpsc, oneshot};
use uuid::Uuid;

const OUTBOUND_QUEUE_CAPACITY: usize = 256;
const STREAM_QUEUE_CAPACITY: usize = 128;

#[derive(Clone, Debug)]
pub struct ClientConfiguration {
    pub socket: PathBuf,
    pub build: BuildIdentity,
    pub role: ClientRole,
    pub client_id: Option<ClientId>,
    pub capabilities: Vec<String>,
}

#[derive(Clone)]
pub struct HostClient {
    outbound: mpsc::Sender<Frame>,
    pending: Arc<Mutex<HashMap<CommandId, oneshot::Sender<HostControl>>>>,
    streams: Arc<Mutex<HashMap<u32, mpsc::Sender<TerminalEvent>>>>,
}

pub struct ClientAttachment {
    pub stream_id: u32,
    pub events: mpsc::Receiver<TerminalEvent>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalEvent {
    Control(TerminalControl),
    SnapshotChunk {
        snapshot_id: Uuid,
        offset: u64,
        bytes: Bytes,
    },
    Output {
        sequence: u64,
        bytes: Bytes,
    },
}

#[derive(Debug, Error)]
pub enum ClientError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("host closed the connection")]
    Closed,
    #[error("invalid host control: {0}")]
    InvalidControl(String),
    #[error("invalid terminal frame")]
    InvalidTerminal,
    #[error("expected welcome, received {0:?}")]
    ExpectedWelcome(Box<HostControl>),
    #[error("host returned {0:?}")]
    Host(Box<HostControl>),
    #[error("response command id did not match")]
    MisdirectedResponse,
    #[error("terminal stream {0} is already attached")]
    StreamInUse(u32),
    #[error("terminal response was malformed: {0}")]
    MalformedResponse(String),
}

impl HostClient {
    pub async fn connect(configuration: ClientConfiguration) -> Result<Self, ClientError> {
        let stream = UnixStream::connect(&configuration.socket).await?;
        let (read_half, write_half) = stream.into_split();
        let mut reader = FrameReader::new(read_half, Direction::HostToClient);
        let mut writer = FrameWriter::new(write_half);
        write_control(
            &mut writer,
            &ClientControl::Hello {
                protocol_version: PROTOCOL_VERSION,
                build: configuration.build,
                role: configuration.role,
                client_id: configuration.client_id,
                capabilities: configuration.capabilities,
                limits: Limits::default(),
            },
        )
        .await?;
        let welcome = read_control(&mut reader).await?;
        if !matches!(welcome, HostControl::Welcome { .. }) {
            return Err(ClientError::ExpectedWelcome(Box::new(welcome)));
        }
        let (outbound, outbound_receiver) = mpsc::channel(OUTBOUND_QUEUE_CAPACITY);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let streams = Arc::new(Mutex::new(HashMap::new()));
        tokio::spawn(run_writer(writer, outbound_receiver));
        tokio::spawn(run_reader(reader, pending.clone(), streams.clone()));
        Ok(Self {
            outbound,
            pending,
            streams,
        })
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, ClientError> {
        let command_id = CommandId(Uuid::new_v4());
        let (reply, response) = oneshot::channel();
        self.pending.lock().await.insert(command_id, reply);
        let payload = encode_control(&ClientControl::Request {
            command_id,
            method: method.into(),
            params,
        })
        .map(Bytes::from)
        .map_err(|error| ClientError::InvalidControl(error.to_string()))?;
        if self
            .outbound
            .send(Frame {
                kind: FrameKind::ClientControl,
                stream_id: 0,
                payload,
            })
            .await
            .is_err()
        {
            self.pending.lock().await.remove(&command_id);
            return Err(ClientError::Closed);
        }
        match response.await.map_err(|_| ClientError::Closed)? {
            HostControl::Result {
                command_id: response_id,
                result,
            } if response_id == command_id => Ok(result),
            response @ HostControl::Error {
                command_id: Some(response_id),
                ..
            } if response_id == command_id => Err(ClientError::Host(Box::new(response))),
            _ => Err(ClientError::MisdirectedResponse),
        }
    }

    pub async fn create_terminal(&self, spec: SpawnSpec) -> Result<PaneInfo, ClientError> {
        let snapshot: ModelSnapshot =
            decode_result(self.request("state.snapshot", Value::Null).await?)?;
        let window_id = snapshot
            .workspace
            .windows
            .keys()
            .next()
            .copied()
            .ok_or_else(|| ClientError::MalformedResponse("workspace has no window".into()))?;
        let space_id = snapshot.workspace.spaces[0].id;
        let content = snapshot
            .workspace
            .content(window_id, space_id)
            .ok_or_else(|| {
                ClientError::MalformedResponse("workspace has no Space content".into())
            })?;
        let pane_id = PaneId(Uuid::new_v4());
        let tab_id = TabId(Uuid::new_v4());
        self.apply_workspace_with_spawns(
            Command::CreateTab {
                window_id,
                space_id,
                tab_id,
                pane_id,
                placement: Placement::Root(RootPlacement {
                    pinned: false,
                    index: content.regular_roots.len(),
                }),
                title: None,
                restart_directory: spec.cwd.clone(),
            },
            Some(snapshot.structure_revision),
            BTreeMap::from([(pane_id, spec)]),
        )
        .await?;
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                if let Some(info) = self
                    .list_terminals()
                    .await?
                    .into_iter()
                    .find(|info| info.id == pane_id)
                {
                    return Ok(info);
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .map_err(|_| ClientError::MalformedResponse("terminal did not start".into()))?
    }

    pub async fn list_terminals(&self) -> Result<Vec<PaneInfo>, ClientError> {
        decode_result(self.request("terminal.list", Value::Null).await?)
    }

    pub async fn attach_terminal(
        &self,
        pane_id: PaneId,
        stream_id: u32,
    ) -> Result<ClientAttachment, ClientError> {
        if stream_id == 0 {
            return Err(ClientError::InvalidTerminal);
        }
        let (sender, events) = mpsc::channel(STREAM_QUEUE_CAPACITY);
        let mut streams = self.streams.lock().await;
        if streams.contains_key(&stream_id) {
            return Err(ClientError::StreamInUse(stream_id));
        }
        streams.insert(stream_id, sender);
        drop(streams);
        let result = self
            .request(
                "terminal.attach",
                json!({"pane_id": pane_id, "stream_id": stream_id}),
            )
            .await;
        if let Err(error) = result {
            self.streams.lock().await.remove(&stream_id);
            return Err(error);
        }
        Ok(ClientAttachment { stream_id, events })
    }

    pub async fn detach_terminal(&self, stream_id: u32) -> Result<(), ClientError> {
        self.request("terminal.detach", json!({"stream_id": stream_id}))
            .await?;
        self.streams.lock().await.remove(&stream_id);
        Ok(())
    }

    pub async fn claim_terminal(&self, stream_id: u32) -> Result<u64, ClientError> {
        let result = self
            .request("terminal.claim", json!({"stream_id": stream_id}))
            .await?;
        result
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| ClientError::MalformedResponse("missing generation".into()))
    }

    pub async fn input(&self, stream_id: u32, bytes: Bytes) -> Result<(), ClientError> {
        if bytes.len() > MAX_TERMINAL_PAYLOAD || stream_id == 0 {
            return Err(ClientError::InvalidTerminal);
        }
        self.outbound
            .send(Frame {
                kind: FrameKind::TerminalInput,
                stream_id,
                payload: bytes,
            })
            .await
            .map_err(|_| ClientError::Closed)
    }

    pub async fn resize_terminal(
        &self,
        stream_id: u32,
        viewport: Viewport,
    ) -> Result<(), ClientError> {
        self.request(
            "terminal.resize",
            json!({"stream_id": stream_id, "viewport": viewport}),
        )
        .await?;
        Ok(())
    }

    pub async fn close_terminal(&self, pane_id: PaneId) -> Result<(), ClientError> {
        let confirmation = self
            .request(
                "workspace.prepare_close",
                json!({"command": Command::ClosePane { pane_id }}),
            )
            .await?;
        let token = confirmation
            .get("tokens")
            .and_then(|tokens| tokens.get(pane_id.to_string()))
            .cloned();
        self.request(
            "terminal.close",
            json!({"pane_id": pane_id, "confirmation_token": token}),
        )
        .await?;
        Ok(())
    }

    pub async fn apply_workspace(
        &self,
        command: Command,
        expected_structure_revision: Option<u64>,
    ) -> Result<ApplyResult, ClientError> {
        self.apply_workspace_with_spawns(command, expected_structure_revision, BTreeMap::new())
            .await
    }

    pub async fn apply_workspace_with_spawns(
        &self,
        command: Command,
        expected_structure_revision: Option<u64>,
        spawn_specs: BTreeMap<PaneId, SpawnSpec>,
    ) -> Result<ApplyResult, ClientError> {
        decode_result(
            self.request(
                "workspace.apply",
                json!({
                    "command": command,
                    "expected_structure_revision": expected_structure_revision,
                    "spawn_specs": spawn_specs
                }),
            )
            .await?,
        )
    }

    pub async fn subscribe(
        &self,
        after_revision: Option<u64>,
    ) -> Result<Subscription, ClientError> {
        decode_result(
            self.request("state.subscribe", json!({"after_revision": after_revision}))
                .await?,
        )
    }
}

async fn run_writer(
    mut writer: FrameWriter<tokio::net::unix::OwnedWriteHalf>,
    mut receiver: mpsc::Receiver<Frame>,
) {
    while let Some(frame) = receiver.recv().await {
        if writer.write(&frame).await.is_err() {
            break;
        }
    }
}

async fn run_reader(
    mut reader: FrameReader<tokio::net::unix::OwnedReadHalf>,
    pending: Arc<Mutex<HashMap<CommandId, oneshot::Sender<HostControl>>>>,
    streams: Arc<Mutex<HashMap<u32, mpsc::Sender<TerminalEvent>>>>,
) {
    while let Ok(Some(frame)) = reader.read().await {
        let delivered = match frame.kind {
            FrameKind::HostControl => {
                let Ok(control) = decode_host_control(&frame.payload) else {
                    break;
                };
                match control {
                    control @ HostControl::Result { command_id, .. }
                    | control @ HostControl::Error {
                        command_id: Some(command_id),
                        ..
                    } => pending
                        .lock()
                        .await
                        .remove(&command_id)
                        .is_some_and(|reply| reply.send(control).is_ok()),
                    HostControl::Terminal { stream_id, event } => {
                        send_terminal(&streams, stream_id, TerminalEvent::Control(event)).await
                    }
                    HostControl::Welcome { .. }
                    | HostControl::Error {
                        command_id: None, ..
                    } => false,
                }
            }
            FrameKind::TerminalOutput => match decode_output(&frame.payload) {
                Some((sequence, bytes)) => {
                    send_terminal(
                        &streams,
                        frame.stream_id,
                        TerminalEvent::Output { sequence, bytes },
                    )
                    .await
                }
                None => false,
            },
            FrameKind::TerminalSnapshot => match decode_snapshot_chunk(&frame.payload) {
                Some((snapshot_id, offset, bytes)) => {
                    send_terminal(
                        &streams,
                        frame.stream_id,
                        TerminalEvent::SnapshotChunk {
                            snapshot_id,
                            offset,
                            bytes,
                        },
                    )
                    .await
                }
                None => false,
            },
            FrameKind::ClientControl | FrameKind::TerminalInput => false,
        };
        if !delivered {
            break;
        }
    }
    pending.lock().await.clear();
    streams.lock().await.clear();
}

async fn send_terminal(
    streams: &Mutex<HashMap<u32, mpsc::Sender<TerminalEvent>>>,
    stream_id: u32,
    event: TerminalEvent,
) -> bool {
    let mut streams = streams.lock().await;
    let Some(sender) = streams.get(&stream_id) else {
        return true;
    };
    if sender.try_send(event).is_err() {
        streams.remove(&stream_id);
    }
    true
}

async fn write_control(
    writer: &mut FrameWriter<tokio::net::unix::OwnedWriteHalf>,
    control: &ClientControl,
) -> Result<(), ClientError> {
    let payload = encode_control(control)
        .map(Bytes::from)
        .map_err(|error| ClientError::InvalidControl(error.to_string()))?;
    writer
        .write(&Frame {
            kind: FrameKind::ClientControl,
            stream_id: 0,
            payload,
        })
        .await?;
    Ok(())
}

async fn read_control(
    reader: &mut FrameReader<tokio::net::unix::OwnedReadHalf>,
) -> Result<HostControl, ClientError> {
    let frame = reader.read().await?.ok_or(ClientError::Closed)?;
    if frame.kind != FrameKind::HostControl || frame.stream_id != 0 {
        return Err(ClientError::InvalidControl("expected host control".into()));
    }
    decode_host_control(&frame.payload)
        .map_err(|error| ClientError::InvalidControl(error.to_string()))
}

fn decode_result<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ClientError> {
    serde_json::from_value(value).map_err(|error| ClientError::MalformedResponse(error.to_string()))
}
