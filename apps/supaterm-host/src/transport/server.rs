use std::time::Duration;

use thiserror::Error;
use tokio::sync::watch;
use tokio::task::JoinSet;

use crate::host::{HostConfig, HostHandle};

use super::{
    ConnectionOutcome, OutboundConfig, OutboundConfigError, RuntimePaths, RuntimeRecordError,
    RuntimeRecordGuard, UnixEndpoint, UnixTransportError, serve_connection,
};

const ACCEPT_RETRY_DELAY: Duration = Duration::from_millis(50);

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub paths: RuntimePaths,
    pub outbound: OutboundConfig,
    pub dedupe_capacity: usize,
    pub dedupe_ttl: Duration,
    pub max_connections: usize,
    pub handshake_timeout: Duration,
    pub drain_timeout: Duration,
}

impl ServerConfig {
    pub fn new(paths: RuntimePaths) -> Self {
        Self {
            paths,
            outbound: OutboundConfig::default(),
            dedupe_capacity: 256,
            dedupe_ttl: Duration::from_secs(5 * 60),
            max_connections: 64,
            handshake_timeout: Duration::from_secs(5),
            drain_timeout: Duration::from_secs(2),
        }
    }
}

#[derive(Clone)]
pub struct ShutdownHandle {
    sender: watch::Sender<bool>,
}

impl ShutdownHandle {
    pub fn request(&self) {
        self.sender.send_replace(true);
    }
}

pub struct UnixServer {
    endpoint: UnixEndpoint,
    host: HostHandle,
    outbound: OutboundConfig,
    shutdown: ShutdownHandle,
    receiver: watch::Receiver<bool>,
    max_connections: usize,
    handshake_timeout: Duration,
    drain_timeout: Duration,
    _record: RuntimeRecordGuard,
}

impl UnixServer {
    pub fn bind(config: ServerConfig) -> Result<Self, ServerError> {
        if config.max_connections == 0 {
            return Err(ServerError::InvalidConnectionLimit);
        }
        config.outbound.validate()?;
        let endpoint = UnixEndpoint::bind(&config.paths)?;
        let record = RuntimeRecordGuard::write(&config.paths)?;
        let mut host_config = HostConfig::new(config.paths.host_id());
        host_config.dedupe_capacity = config.dedupe_capacity;
        host_config.dedupe_ttl = config.dedupe_ttl;
        let host = HostHandle::start(host_config);
        let (sender, receiver) = watch::channel(false);
        Ok(Self {
            endpoint,
            host,
            outbound: config.outbound,
            shutdown: ShutdownHandle { sender },
            receiver,
            max_connections: config.max_connections,
            handshake_timeout: config.handshake_timeout,
            drain_timeout: config.drain_timeout,
            _record: record,
        })
    }

    pub fn shutdown_handle(&self) -> ShutdownHandle {
        self.shutdown.clone()
    }

    pub fn path(&self) -> &std::path::Path {
        self.endpoint.path()
    }

    pub async fn run(mut self) -> Result<(), ServerError> {
        let mut connections = JoinSet::new();
        loop {
            tokio::select! {
                accepted = self.endpoint.accept(), if connections.len() < self.max_connections => {
                    match accepted {
                        Ok(stream) => {
                            let (input, output) = stream.into_split();
                            let host = self.host.clone();
                            let receiver = self.receiver.clone();
                            let shutdown = self.shutdown.clone();
                            let outbound = self.outbound;
                            let handshake_timeout = self.handshake_timeout;
                            connections.spawn(async move {
                                let outcome = serve_connection(
                                    input,
                                    output,
                                    host,
                                    receiver,
                                    outbound,
                                    handshake_timeout,
                                ).await;
                                if matches!(outcome, Ok(ConnectionOutcome::ShutdownRequested)) {
                                    shutdown.request();
                                }
                                outcome
                            });
                        }
                        Err(UnixTransportError::PeerUid { .. }) => {}
                        Err(error) if retryable_accept_error(&error) => {
                            if wait_for_accept_retry(&mut self.receiver).await {
                                break;
                            }
                        }
                        Err(error) => return Err(error.into()),
                    }
                }
                changed = self.receiver.changed() => {
                    if changed.is_err() || *self.receiver.borrow() {
                        break;
                    }
                }
                joined = connections.join_next(), if !connections.is_empty() => {
                    if let Some(Err(error)) = joined {
                        return Err(ServerError::Join(error.to_string()));
                    }
                }
            }
        }
        drop(self.endpoint);
        let drain = async {
            while let Some(result) = connections.join_next().await {
                if let Err(error) = result {
                    return Err(ServerError::Join(error.to_string()));
                }
            }
            Ok(())
        };
        match tokio::time::timeout(self.drain_timeout, drain).await {
            Ok(result) => result,
            Err(_) => {
                connections.abort_all();
                while connections.join_next().await.is_some() {}
                Err(ServerError::DrainTimedOut)
            }
        }
    }
}

fn retryable_accept_error(error: &UnixTransportError) -> bool {
    let UnixTransportError::Io(error) = error else {
        return false;
    };
    matches!(
        error.raw_os_error(),
        Some(libc::EMFILE | libc::ENFILE | libc::ENOBUFS | libc::ENOMEM)
    ) || matches!(
        error.kind(),
        std::io::ErrorKind::ConnectionAborted | std::io::ErrorKind::Interrupted
    )
}

async fn wait_for_accept_retry(stop: &mut watch::Receiver<bool>) -> bool {
    if *stop.borrow() {
        return true;
    }
    tokio::select! {
        _ = tokio::time::sleep(ACCEPT_RETRY_DELAY) => false,
        changed = stop.changed() => changed.is_err() || *stop.borrow(),
    }
}

#[derive(Debug, Error)]
pub enum ServerError {
    #[error(transparent)]
    Unix(#[from] UnixTransportError),
    #[error(transparent)]
    RuntimeRecord(#[from] RuntimeRecordError),
    #[error("connection limit must be greater than zero")]
    InvalidConnectionLimit,
    #[error(transparent)]
    OutboundConfig(#[from] OutboundConfigError),
    #[error("connection task failed: {0}")]
    Join(String),
    #[error("connection drain timed out")]
    DrainTimedOut,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_descriptor_pressure_is_a_retryable_accept_error() {
        for code in [libc::EMFILE, libc::ENFILE] {
            let error = UnixTransportError::Io(std::io::Error::from_raw_os_error(code));
            assert!(retryable_accept_error(&error));
        }
    }
}
