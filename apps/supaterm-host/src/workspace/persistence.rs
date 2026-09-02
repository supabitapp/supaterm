use crate::protocol::control::HostId;
use crate::workspace::model::{ClientState, SpaceId, WindowId, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 1;
const SAVE_QUEUE_CAPACITY: usize = 32;
const SAVE_DEBOUNCE: Duration = Duration::from_millis(25);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DurableDocument {
    pub schema_version: u32,
    pub host_id: HostId,
    pub workspace: Workspace,
    pub clients: Vec<ClientState>,
    pub settings: BTreeMap<String, Value>,
}

impl DurableDocument {
    pub fn new(host_id: HostId, workspace: Workspace, clients: Vec<ClientState>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            host_id,
            workspace,
            clients,
            settings: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> bool {
        self.schema_version == SCHEMA_VERSION && self.workspace.validate(&self.clients).is_ok()
    }
}

pub struct LoadedDocument {
    pub document: DurableDocument,
    pub reset: bool,
}

pub fn load_or_reset(path: &Path) -> io::Result<LoadedDocument> {
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<DurableDocument>(&bytes) {
            Ok(document) if document.validate() => Ok(LoadedDocument {
                document,
                reset: false,
            }),
            _ => Ok(LoadedDocument {
                document: clean_document(),
                reset: true,
            }),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(LoadedDocument {
            document: clean_document(),
            reset: false,
        }),
        Err(error) => Err(error),
    }
}

#[derive(Clone)]
pub struct PersistenceWorker {
    sender: mpsc::Sender<Message>,
}

impl PersistenceWorker {
    pub fn spawn(path: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel(SAVE_QUEUE_CAPACITY);
        tokio::spawn(run(path, receiver));
        Self { sender }
    }

    pub async fn save(&self, document: DurableDocument) -> io::Result<()> {
        self.sender
            .send(Message::Save(document))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "persistence worker stopped"))
    }

    pub async fn flush(&self) -> io::Result<()> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Message::Flush(reply))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "persistence worker stopped"))?;
        response
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "persistence worker stopped"))?
    }
}

enum Message {
    Save(DurableDocument),
    Flush(oneshot::Sender<io::Result<()>>),
}

async fn run(path: PathBuf, mut receiver: mpsc::Receiver<Message>) {
    let mut pending = None;
    loop {
        if pending.is_none() {
            match receiver.recv().await {
                Some(Message::Save(document)) => pending = Some(document),
                Some(Message::Flush(reply)) => {
                    let _ = reply.send(Ok(()));
                }
                None => break,
            }
            continue;
        }
        tokio::select! {
            message = receiver.recv() => {
                match message {
                    Some(Message::Save(document)) => pending = Some(document),
                    Some(Message::Flush(reply)) => {
                        let result = persist_pending(&path, &mut pending).await;
                        let _ = reply.send(result);
                    }
                    None => {
                        let _ = persist_pending(&path, &mut pending).await;
                        break;
                    }
                }
            }
            () = tokio::time::sleep(SAVE_DEBOUNCE) => {
                let _ = persist_pending(&path, &mut pending).await;
            }
        }
    }
}

async fn persist_pending(path: &Path, pending: &mut Option<DurableDocument>) -> io::Result<()> {
    let Some(document) = pending.clone() else {
        return Ok(());
    };
    let path = path.to_owned();
    let result = tokio::task::spawn_blocking(move || write_document(&path, &document))
        .await
        .map_err(io::Error::other)?;
    if result.is_ok() {
        pending.take();
    }
    result
}

fn write_document(path: &Path, document: &DurableDocument) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "state path has no parent"))?;
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let bytes = serde_json::to_vec(document).map_err(io::Error::other)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::File::open(parent)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn clean_document() -> DurableDocument {
    let space_id = SpaceId(Uuid::from_u128(1));
    let window_id = WindowId(Uuid::new_v4());
    DurableDocument::new(
        HostId(Uuid::new_v4()),
        Workspace::new(space_id, window_id, "Space 1".into()),
        Vec::new(),
    )
}
