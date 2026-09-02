mod bootstrap;
mod client;
mod connection;
mod outbound;
mod paths;
mod record;
mod server;
mod stdio;
mod unix;

pub use bootstrap::{BootstrapError, connect_or_start};
pub use client::{ClientError, ReferenceClient};
pub use connection::{ConnectionError, ConnectionOutcome, serve_connection};
pub use outbound::{
    OutboundConfig, OutboundConfigError, OutboundError, OutboundSender, spawn_outbound,
};
pub use paths::{PathEnvironment, RuntimePaths, RuntimePathsError};
pub use record::{HostRuntimeRecord, RuntimeRecordError, RuntimeRecordGuard};
pub use server::{ServerConfig, ServerError, ShutdownHandle, UnixServer};
pub use stdio::bridge_stdio;
pub use unix::{UnixEndpoint, UnixTransportError, verify_peer_uid, verify_peer_uid_against};
