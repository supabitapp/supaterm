mod client;
mod ids;
mod protocol;
mod runtime;
mod server;
mod terminal;
mod transport;

use std::{
    future::Future,
    io,
    os::unix::fs::{FileTypeExt, MetadataExt},
    path::{Path, PathBuf},
    sync::Arc,
};

pub use client::{AttachmentInfo, HostClient, HostRequestHandle};
pub use ids::{AttachmentId, BootId, ClientId, MachineId, RequestId, TerminalId};
pub use protocol::{
    ClientEnvelope, ClientRole, CommandSpec, EnvironmentSpec, ErrorCode, HostEnvelope, HostMessage,
    HostRole, MAX_FRAME_BYTES, MAX_TERMINAL_DATA_BYTES, PROTOCOL_EPOCH, ProcessExit, Request,
    TerminalData, TerminalInfo, TerminalSize, TerminalStatus,
};
pub use runtime::HostPaths;
use runtime::PreparedRuntime;
use terminal::HostState;
use thiserror::Error;
use tokio::net::UnixListener;

#[derive(Debug, Error)]
pub enum HostError {
    #[error("another host already owns this runtime root")]
    AlreadyRunning,
    #[error("invalid host root: {0}")]
    InvalidRoot(PathBuf),
    #[error("host root belongs to another user: {0}")]
    RootOwner(PathBuf),
    #[error("invalid host lock: {0}")]
    InvalidLock(PathBuf),
    #[error("unsafe socket path: {0}")]
    UnsafeSocket(PathBuf),
    #[error("a live socket already exists at {0}")]
    SocketInUse(PathBuf),
    #[error("invalid machine identity: {0}")]
    InvalidMachineId(PathBuf),
    #[error("invalid frame length: {0}")]
    InvalidFrameLength(usize),
    #[error("invalid host config: {0}")]
    InvalidConfig(String),
    #[error("connection closed")]
    ConnectionClosed,
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("unexpected host response: {0}")]
    UnexpectedResponse(String),
    #[error("host task failed: {0}")]
    Task(String),
    #[error("remote error {code:?}: {message}")]
    Remote { code: ErrorCode, message: String },
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug)]
pub struct HostConfig {
    pub paths: HostPaths,
    pub connection_queue_capacity: usize,
    pub input_queue_capacity: usize,
}

impl HostConfig {
    pub fn new(runtime_root: impl Into<PathBuf>, state_root: impl Into<PathBuf>) -> Self {
        Self {
            paths: HostPaths::new(runtime_root, state_root),
            connection_queue_capacity: 128,
            input_queue_capacity: 128,
        }
    }

    pub fn for_test(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self::new(&root, &root)
    }
}

pub struct HostServer {
    boot_id: BootId,
    listener: UnixListener,
    _socket: BoundSocket,
    runtime: PreparedRuntime,
    state: Arc<HostState>,
    connection_queue_capacity: usize,
}

impl std::fmt::Debug for HostServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostServer")
            .field("boot_id", &self.boot_id)
            .field("machine_id", &self.runtime.machine_id)
            .field("socket_path", &self.runtime.socket_path())
            .finish()
    }
}

impl HostServer {
    pub async fn bind(config: HostConfig) -> Result<Self, HostError> {
        if config.connection_queue_capacity == 0 || config.input_queue_capacity == 0 {
            return Err(HostError::InvalidConfig(
                "queue capacities must be nonzero".into(),
            ));
        }
        let runtime = config.paths.prepare()?;
        let listener = UnixListener::bind(runtime.socket_path())?;
        let socket = BoundSocket::new(runtime.socket_path())?;
        std::fs::set_permissions(
            runtime.socket_path(),
            std::os::unix::fs::PermissionsExt::from_mode(0o600),
        )?;
        let boot_id = BootId::new();
        Ok(Self {
            boot_id,
            listener,
            _socket: socket,
            state: Arc::new(HostState::new(boot_id, config.input_queue_capacity)),
            connection_queue_capacity: config.connection_queue_capacity,
            runtime,
        })
    }

    pub fn boot_id(&self) -> BootId {
        self.boot_id
    }

    pub fn machine_id(&self) -> MachineId {
        self.runtime.machine_id
    }

    pub fn socket_path(&self) -> &std::path::Path {
        self.runtime.socket_path()
    }

    pub async fn run(self) -> Result<(), HostError> {
        self.run_until(std::future::pending()).await
    }

    pub async fn run_until<F>(self, shutdown: F) -> Result<(), HostError>
    where
        F: Future<Output = ()>,
    {
        server::run_host(
            &self.listener,
            Arc::clone(&self.state),
            self.runtime.machine_id,
            self.boot_id,
            self.connection_queue_capacity,
            shutdown,
        )
        .await
    }
}

struct BoundSocket {
    path: PathBuf,
    device: u64,
    inode: u64,
}

impl BoundSocket {
    fn new(path: &Path) -> Result<Self, HostError> {
        let metadata = std::fs::symlink_metadata(path)?;
        Ok(Self {
            path: path.to_path_buf(),
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }
}

impl Drop for BoundSocket {
    fn drop(&mut self) {
        if matches!(
            std::fs::symlink_metadata(&self.path),
            Ok(metadata)
                if metadata.file_type().is_socket()
                    && metadata.dev() == self.device
                    && metadata.ino() == self.inode
        ) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
