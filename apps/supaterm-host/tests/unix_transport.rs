use serde_json::Value;
use supaterm_host::client::{ClientConfiguration, HostClient};
use supaterm_host::host::actor::{HostActor, HostConfiguration};
use supaterm_host::protocol::control::{BuildIdentity, ClientId, ClientRole, HostId};
use supaterm_host::runtime::{PathConfiguration, RuntimePaths};
use supaterm_host::transport::unix::{UnixServer, peer_uid, serve_connection};
use tempfile::tempdir;
use tokio::net::UnixStream;
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
    let mut client = HostClient::connect(ClientConfiguration {
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
