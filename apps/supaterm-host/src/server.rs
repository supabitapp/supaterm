use crate::agent::machine::MachineEnvironment;
use crate::host::actor::{HostActor, HostConfiguration};
use crate::protocol::control::BuildIdentity;
use crate::runtime::{ProcessRecord, RuntimePaths};
use crate::terminal::pty::{SpawnSpec, TerminalEnvironment};
use crate::transport::unix::{UnixServer, serve_connection};
use crate::workspace::persistence::{PersistenceWorker, load_or_reset};
use std::fs;
use std::io;
use tokio::signal::unix::{SignalKind, signal};
use tokio::task::JoinSet;
use uuid::Uuid;

pub async fn serve(paths: RuntimePaths, build: BuildIdentity) -> io::Result<()> {
    let loaded = load_or_reset(&paths.durable_state)?;
    let restart_panes = loaded.document.workspace.restart_panes();
    let persistence = PersistenceWorker::spawn(paths.durable_state.clone());
    persistence.save(loaded.document.clone()).await?;
    let actor = HostActor::spawn_with_document(
        HostConfiguration {
            host_id: loaded.document.host_id,
            epoch: Uuid::new_v4(),
            build: build.clone(),
            capabilities: vec!["semantic_state".into(), "terminal_snapshot".into()],
            command_cache_capacity: 2048,
            terminal_environment: Some(TerminalEnvironment {
                socket_path: paths.socket.clone(),
                cli_path: std::env::current_exe()?.with_file_name("sp"),
                state_home: Some(paths.state_root.clone()),
            }),
            machine_environment: Some(MachineEnvironment {
                home_directory: paths.home_directory.clone(),
                state_root: paths.state_root.clone(),
            }),
        },
        loaded.document,
        Some(persistence.clone()),
    );
    for (pane_id, restart_directory) in restart_panes {
        actor
            .restore_terminal(
                pane_id,
                SpawnSpec {
                    argv: Vec::new(),
                    cwd: restart_directory.filter(|directory| directory.is_dir()),
                    environment: Vec::new(),
                    rows: 24,
                    columns: 80,
                    pixel_width: 800,
                    pixel_height: 480,
                },
            )
            .await
            .map_err(io::Error::other)?;
    }
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
    actor
        .terminals()
        .shutdown()
        .await
        .map_err(io::Error::other)?;
    persistence.flush().await?;
    if paths.process_record.exists() {
        fs::remove_file(paths.process_record)?;
    }
    Ok(())
}
