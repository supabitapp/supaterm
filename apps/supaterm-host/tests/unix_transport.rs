use bytes::Bytes;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use supaterm_host::client::{ClientAttachment, ClientConfiguration, HostClient, TerminalEvent};
use supaterm_host::host::actor::{HostActor, HostConfiguration};
use supaterm_host::protocol::control::{BuildIdentity, ClientId, ClientRole, HostId};
use supaterm_host::protocol::terminal::TerminalControl;
use supaterm_host::runtime::{PathConfiguration, RuntimePaths};
use supaterm_host::terminal::actor::Viewport;
use supaterm_host::terminal::pty::SpawnSpec;
use supaterm_host::transport::unix::{UnixServer, peer_uid, serve_connection};
use tempfile::tempdir;
use tokio::net::UnixStream;
use tokio::time::timeout;
use uuid::Uuid;

fn build() -> BuildIdentity {
    BuildIdentity {
        version: "26.0.0".into(),
        fingerprint: "build-a".into(),
    }
}

fn actor() -> HostActor {
    HostActor::spawn(HostConfiguration {
        host_id: HostId(Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap()),
        epoch: Uuid::parse_str("44444444-4444-4444-8444-444444444444").unwrap(),
        build: build(),
        capabilities: vec!["semantic_state".into()],
        command_cache_capacity: 16,
    })
}

fn paths() -> (tempfile::TempDir, RuntimePaths) {
    let root = tempdir().unwrap();
    let paths = RuntimePaths::initialize(PathConfiguration {
        state_home: Some(root.path().join("state")),
        home_directory: root.path().join("home"),
        xdg_runtime_directory: Some(root.path().join("run")),
        temporary_directory: root.path().join("tmp"),
        uid: unsafe { libc::geteuid() },
    })
    .unwrap();
    (root, paths)
}

#[tokio::test]
async fn local_client_handshakes_and_reads_a_correlated_snapshot() {
    let (_root, paths) = paths();
    let server = UnixServer::bind(&paths).await.unwrap();
    let host = actor();
    let connection_task = tokio::spawn({
        let host = host.clone();
        async move {
            let (stream, _) = server.accept().await.unwrap();
            serve_connection(stream, host).await.unwrap();
        }
    });
    let client = HostClient::connect(ClientConfiguration {
        socket: paths.socket.clone(),
        build: build(),
        role: ClientRole::Ui,
        client_id: Some(ClientId(Uuid::new_v4())),
        capabilities: vec!["semantic_state".into()],
    })
    .await
    .unwrap();

    let snapshot = client.request("state.snapshot", Value::Null).await.unwrap();

    assert_eq!(snapshot["revision"], 0);
    assert_eq!(snapshot["workspace"]["spaces"], Value::Array(vec![]));
    drop(client);
    connection_task.await.unwrap();
}

#[tokio::test]
async fn accepted_socket_reports_the_current_uid() {
    let (_root, paths) = paths();
    let server = UnixServer::bind(&paths).await.unwrap();
    let client = tokio::spawn(UnixStream::connect(paths.socket.clone()));
    let (stream, _) = server.accept().await.unwrap();

    assert_eq!(peer_uid(&stream).unwrap(), unsafe { libc::geteuid() });
    client.await.unwrap().unwrap();
}

fn terminal_spec() -> SpawnSpec {
    SpawnSpec {
        argv: vec![
            "/bin/sh".into(),
            "-c".into(),
            "while read value; do printf '%s DONE\\n' \"$value\"; done".into(),
        ],
        cwd: None,
        environment: vec![],
        rows: 24,
        columns: 80,
        pixel_width: 800,
        pixel_height: 480,
    }
}

async fn ready(attachment: &mut ClientAttachment) -> u64 {
    timeout(Duration::from_secs(3), async {
        let mut snapshot_id = None;
        let mut expected_length = None;
        let mut snapshot = Vec::new();
        loop {
            match attachment.events.recv().await.unwrap() {
                TerminalEvent::Control(TerminalControl::Attached {
                    snapshot_id: id, ..
                }) => snapshot_id = Some(id),
                TerminalEvent::Control(TerminalControl::SnapshotBegin {
                    snapshot_id: id,
                    declared_length,
                    ..
                }) => {
                    assert_eq!(Some(id), snapshot_id);
                    expected_length = Some(declared_length);
                }
                TerminalEvent::SnapshotChunk {
                    snapshot_id: id,
                    offset,
                    bytes,
                } => {
                    assert_eq!(Some(id), snapshot_id);
                    assert_eq!(offset, snapshot.len() as u64);
                    snapshot.extend_from_slice(&bytes);
                }
                TerminalEvent::Control(TerminalControl::SnapshotEnd {
                    snapshot_id: id,
                    total_length,
                    sha256,
                }) => {
                    assert_eq!(Some(id), snapshot_id);
                    assert_eq!(Some(total_length), expected_length);
                    assert_eq!(snapshot.len() as u64, total_length);
                    assert_eq!(<[u8; 32]>::from(Sha256::digest(&snapshot)), sha256);
                }
                TerminalEvent::Control(TerminalControl::Ready { next_sequence }) => {
                    return next_sequence;
                }
                event => panic!("unexpected attach event: {event:?}"),
            }
        }
    })
    .await
    .unwrap()
}

async fn output(attachment: &mut ClientAttachment, expected: &mut u64, needle: &[u8]) {
    timeout(Duration::from_secs(3), async {
        let mut output = Vec::new();
        while !output.windows(needle.len()).any(|bytes| bytes == needle) {
            match attachment.events.recv().await.unwrap() {
                TerminalEvent::Output { sequence, bytes } => {
                    assert_eq!(sequence, *expected);
                    *expected += bytes.len() as u64;
                    output.extend_from_slice(&bytes);
                }
                event => panic!("unexpected live event: {event:?}"),
            }
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn reference_client_drives_the_full_terminal_lifecycle() {
    let (_root, paths) = paths();
    let server = UnixServer::bind(&paths).await.unwrap();
    let host = actor();
    let connection_task = tokio::spawn({
        let host = host.clone();
        async move {
            let (stream, _) = server.accept().await.unwrap();
            serve_connection(stream, host).await.unwrap();
        }
    });
    let client = HostClient::connect(ClientConfiguration {
        socket: paths.socket.clone(),
        build: build(),
        role: ClientRole::Ui,
        client_id: Some(ClientId(Uuid::new_v4())),
        capabilities: vec!["terminal_snapshot".into()],
    })
    .await
    .unwrap();
    let pane = client.create_terminal(terminal_spec()).await.unwrap();
    assert_eq!(client.list_terminals().await.unwrap(), vec![pane]);

    let mut first = client.attach_terminal(pane.id, 7).await.unwrap();
    let mut first_sequence = ready(&mut first).await;
    client.claim_terminal(7).await.unwrap();
    client
        .resize_terminal(
            7,
            Viewport {
                rows: 30,
                columns: 100,
                pixel_width: 1_000,
                pixel_height: 600,
            },
        )
        .await
        .unwrap();
    client
        .input(7, Bytes::from_static(b"first\n"))
        .await
        .unwrap();
    output(&mut first, &mut first_sequence, b"first DONE").await;
    client.detach_terminal(7).await.unwrap();
    assert_eq!(unsafe { libc::kill(pane.pid as i32, 0) }, 0);

    let mut second = client.attach_terminal(pane.id, 8).await.unwrap();
    let mut second_sequence = ready(&mut second).await;
    assert_eq!(client.list_terminals().await.unwrap()[0].pid, pane.pid);
    client.claim_terminal(8).await.unwrap();
    client
        .input(8, Bytes::from_static(b"second\n"))
        .await
        .unwrap();
    output(&mut second, &mut second_sequence, b"second DONE").await;
    client.close_terminal(pane.id).await.unwrap();
    drop(client);
    connection_task.await.unwrap();
}
