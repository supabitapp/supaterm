use crate::host::actor::{HostActor, HostConfiguration};
use crate::host::persistence::load_or_create_host_id;
use crate::protocol::control::BuildIdentity;
use crate::runtime::{ProcessRecord, RuntimePaths};
use crate::transport::unix::{UnixServer, serve_connection};
use std::fs;
use std::io;
use tokio::signal::unix::{SignalKind, signal};
use tokio::task::JoinSet;
use uuid::Uuid;

pub async fn serve(paths: RuntimePaths, build: BuildIdentity) -> io::Result<()> {
    let host_id = load_or_create_host_id(&paths.durable_state)?;
    let actor = HostActor::spawn(HostConfiguration {
        host_id,
        epoch: Uuid::new_v4(),
        build: build.clone(),
        capabilities: vec!["semantic_state".into(), "terminal_snapshot".into()],
        command_cache_capacity: 2048,
    });
    let server = UnixServer::bind(&paths).await.map_err(io::Error::other)?;
    ProcessRecord::current(build)
        .map_err(io::Error::other)?
        .write(&paths.process_record)
        .map_err(io::Error::other)?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = server.accept() => {
                let (stream, _) = accepted?;
                let actor = actor.clone();
                connections.spawn(async move {
                    let _ = serve_connection(stream, actor).await;
                });
            }
            _ = interrupt.recv() => break,
            _ = terminate.recv() => break,
        }
    }
    drop(server);
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    if paths.process_record.exists() {
        fs::remove_file(paths.process_record)?;
    }
    Ok(())
}
