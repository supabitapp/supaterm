use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt, symlink};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use supaterm_host::host::{HostConfig, HostHandle};
use supaterm_host::protocol::{
    Command, CommandResult, Direction, Frame, FrameKind, FrameReader, HostMessage,
};
use supaterm_host::transport::{
    HostRuntimeRecord, OutboundConfig, OutboundConfigError, OutboundError, PathEnvironment,
    RuntimePaths, RuntimePathsError, RuntimeRecordGuard, ServerConfig, ServerError, UnixEndpoint,
    UnixServer, UnixTransportError, spawn_outbound, verify_peer_uid_against,
};

static DIRECTORY_ID: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(name: &str) -> Self {
        let sequence = DIRECTORY_ID.fetch_add(1, Ordering::Relaxed);
        let path =
            PathBuf::from("/tmp").join(format!("sth-{name}-{}-{sequence}", std::process::id()));
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn environment(directory: &TestDirectory) -> PathEnvironment {
    PathEnvironment {
        state_home: Some(OsString::from(directory.0.join("state"))),
        xdg_runtime_dir: Some(OsString::from(directory.0.join("run"))),
        home: None,
        temporary_directory: directory.0.join("tmp"),
        current_directory: directory.0.clone(),
        uid: unsafe { libc::getuid() },
    }
}

#[test]
fn state_and_runtime_paths_are_stable_private_and_compatible() {
    let directory = TestDirectory::new("paths");
    let first = RuntimePaths::resolve_from(environment(&directory)).unwrap();
    let second = RuntimePaths::resolve_from(environment(&directory)).unwrap();
    assert_eq!(first, second);
    assert!(first.state_root.ends_with("state"));
    assert_eq!(
        fs::metadata(&first.state_root)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(&first.runtime_directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );

    let home = directory.0.join("home");
    let mut fallback = environment(&directory);
    fallback.state_home = Some(OsString::from(" \n\t "));
    fallback.home = Some(OsString::from(&home));
    let fallback = RuntimePaths::resolve_from(fallback).unwrap();
    assert_eq!(
        fallback.state_root,
        fs::canonicalize(home.join(".config/supaterm")).unwrap()
    );

    let mut tilde = environment(&directory);
    tilde.state_home = Some(OsString::from(" ~/custom/../state "));
    tilde.home = Some(OsString::from(&home));
    let tilde = RuntimePaths::resolve_from(tilde).unwrap();
    assert_eq!(
        tilde.state_root,
        fs::canonicalize(home.join("state")).unwrap()
    );

    let mut relative_runtime = environment(&directory);
    relative_runtime.xdg_runtime_dir = Some(OsString::from("relative"));
    let relative_runtime = RuntimePaths::resolve_from(relative_runtime).unwrap();
    assert!(relative_runtime.runtime_directory.is_absolute());
    assert!(!relative_runtime.runtime_directory.starts_with("relative"));

    let mut relative_temporary = environment(&directory);
    relative_temporary.xdg_runtime_dir = None;
    relative_temporary.temporary_directory = PathBuf::from("relative");
    let relative_temporary = RuntimePaths::resolve_from(relative_temporary).unwrap();
    assert!(
        relative_temporary
            .runtime_directory
            .starts_with(format!("/tmp/supaterm-{}", unsafe { libc::getuid() }))
    );
}

#[test]
fn explicit_socket_does_not_change_parent_permissions() {
    let directory = TestDirectory::new("explicit-permissions");
    fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o755)).unwrap();

    assert!(matches!(
        RuntimePaths::for_socket(directory.0.join("host.sock")),
        Err(RuntimePathsError::UnsafeRuntimeDirectory { .. })
    ));
    assert_eq!(
        fs::metadata(&directory.0).unwrap().permissions().mode() & 0o777,
        0o755
    );
}

#[test]
fn runtime_path_rejects_a_symlinked_private_parent() {
    let directory = TestDirectory::new("symlink");
    let xdg = directory.0.join("run");
    let target = directory.0.join("redirected");
    fs::create_dir_all(&xdg).unwrap();
    fs::create_dir_all(&target).unwrap();
    symlink(&target, xdg.join("supaterm")).unwrap();
    let mut environment = environment(&directory);
    environment.xdg_runtime_dir = Some(xdg.into_os_string());
    assert!(matches!(
        RuntimePaths::resolve_from(environment),
        Err(RuntimePathsError::UnsafeRuntimeDirectory { .. })
    ));
}

#[tokio::test]
async fn socket_binding_is_private_locked_and_stale_safe() {
    let directory = TestDirectory::new("socket");
    let socket = directory.0.join("host.sock");
    let paths = RuntimePaths::for_socket(&socket).unwrap();

    let stale = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    drop(stale);
    let endpoint = UnixEndpoint::bind(&paths).unwrap();
    assert_eq!(
        fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(matches!(
        UnixEndpoint::bind(&paths),
        Err(UnixTransportError::AlreadyServing { .. })
    ));
    let client = tokio::net::UnixStream::connect(&socket).await.unwrap();
    endpoint.accept().await.unwrap();
    drop(client);
    drop(endpoint);
    assert!(!socket.exists());

    let live = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    assert!(matches!(
        UnixEndpoint::bind(&paths),
        Err(UnixTransportError::AlreadyServing { .. })
    ));
    assert!(socket.exists());
    drop(live);
    fs::remove_file(&socket).unwrap();

    fs::write(&socket, b"not a socket").unwrap();
    assert!(matches!(
        UnixEndpoint::bind(&paths),
        Err(UnixTransportError::UnsafeSocketPath { .. })
    ));
    assert_eq!(fs::read(&socket).unwrap(), b"not a socket");
}

#[tokio::test]
async fn peer_uid_mismatch_is_rejected() {
    let directory = TestDirectory::new("peer-uid");
    let socket = directory.0.join("peer.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let client = tokio::net::UnixStream::connect(&socket).await.unwrap();
    let (accepted, _) = listener.accept().await.unwrap();
    let current = unsafe { libc::getuid() };
    assert!(matches!(
        verify_peer_uid_against(&accepted, current.wrapping_add(1)),
        Err(UnixTransportError::PeerUid {
            expected,
            received,
        }) if expected == current.wrapping_add(1) && received == current
    ));
    drop(client);
}

#[test]
fn runtime_record_is_private_and_self_removing() {
    let directory = TestDirectory::new("record");
    let paths = RuntimePaths::for_socket(directory.0.join("host.sock")).unwrap();
    let guard = RuntimeRecordGuard::write(&paths).unwrap();
    let decoded: HostRuntimeRecord =
        serde_json::from_slice(&fs::read(&paths.start_record).unwrap()).unwrap();
    assert_eq!(guard.record(), &decoded);
    assert_eq!(decoded.pid, std::process::id());
    assert_eq!(decoded.uid, unsafe { libc::getuid() });
    assert_eq!(
        fs::metadata(&paths.start_record)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    drop(guard);
    assert!(!paths.start_record.exists());
}

#[tokio::test]
async fn outbound_queue_rejects_a_frame_larger_than_its_byte_budget() {
    let config = OutboundConfig {
        control_messages: 1,
        control_bytes: 8,
        terminal_messages: 1,
        terminal_bytes: 8,
    };
    let (sender, writer) = spawn_outbound(tokio::io::sink(), config).unwrap();
    let frame = Frame::new(FrameKind::HostControl, 0, b"{}".to_vec()).unwrap();
    assert!(matches!(
        sender.send(frame).await,
        Err(OutboundError::TooLarge)
    ));
    drop(sender);
    writer.await.unwrap().unwrap();
}

#[tokio::test]
async fn invalid_outbound_queue_bounds_return_errors_without_panicking() {
    let directory = TestDirectory::new("outbound-config");
    let paths = RuntimePaths::for_socket(directory.0.join("host.sock")).unwrap();
    let mut invalid = Vec::new();
    for maximum in [0, tokio::sync::Semaphore::MAX_PERMITS + 1] {
        invalid.push(OutboundConfig {
            control_messages: maximum,
            ..OutboundConfig::default()
        });
        invalid.push(OutboundConfig {
            control_bytes: maximum,
            ..OutboundConfig::default()
        });
        invalid.push(OutboundConfig {
            terminal_messages: maximum,
            ..OutboundConfig::default()
        });
        invalid.push(OutboundConfig {
            terminal_bytes: maximum,
            ..OutboundConfig::default()
        });
    }

    for outbound in invalid {
        let spawned = catch_unwind(AssertUnwindSafe(|| {
            spawn_outbound(tokio::io::sink(), outbound)
        }));
        assert!(matches!(
            spawned,
            Ok(Err(OutboundConfigError::InvalidBound { .. }))
        ));

        let mut config = ServerConfig::new(paths.clone());
        config.outbound = outbound;
        let bound = catch_unwind(AssertUnwindSafe(|| UnixServer::bind(config)));
        assert!(matches!(
            bound,
            Ok(Err(ServerError::OutboundConfig(
                OutboundConfigError::InvalidBound { .. }
            )))
        ));
    }
}

#[tokio::test]
async fn outbound_queue_schedules_control_amid_terminal_traffic() {
    let config = OutboundConfig {
        control_messages: 4,
        control_bytes: 1024,
        terminal_messages: 16,
        terminal_bytes: 16 * 1024,
    };
    let (output, input) = tokio::io::duplex(64);
    let (sender, writer) = spawn_outbound(output, config).unwrap();
    for stream_id in 1..=10 {
        sender
            .send(Frame::new(FrameKind::TerminalOutput, stream_id, vec![0; 1024]).unwrap())
            .await
            .unwrap();
    }
    sender
        .send(Frame::new(FrameKind::HostControl, 0, b"{}".to_vec()).unwrap())
        .await
        .unwrap();
    drop(sender);
    let mut reader = FrameReader::new(input, Direction::HostToClient);
    let mut kinds = Vec::new();
    for _ in 0..11 {
        kinds.push(reader.read_frame().await.unwrap().unwrap().kind());
    }
    assert!(
        kinds
            .iter()
            .position(|kind| *kind == FrameKind::HostControl)
            .unwrap()
            <= 2
    );
    writer.await.unwrap().unwrap();
}

#[tokio::test]
async fn command_result_cache_evicts_at_its_fixed_capacity() {
    let mut config = HostConfig::new("bounded-cache");
    config.dedupe_capacity = 1;
    config.dedupe_ttl = Duration::from_secs(60);
    let host = HostHandle::start(config);
    host.execute(
        "client".to_owned(),
        "request-1".to_owned(),
        "command-1".to_owned(),
        Command::Ping,
    )
    .await
    .unwrap();
    host.execute(
        "client".to_owned(),
        "request-2".to_owned(),
        "command-2".to_owned(),
        Command::Ping,
    )
    .await
    .unwrap();
    let retried = host
        .execute(
            "client".to_owned(),
            "request-3".to_owned(),
            "command-1".to_owned(),
            Command::Ping,
        )
        .await
        .unwrap();
    assert!(matches!(
        retried.message,
        HostMessage::Result {
            result: CommandResult::Pong {
                accepted_commands: 3
            },
            ..
        }
    ));
}
