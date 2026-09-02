use std::fs::{self, OpenOptions};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use bytes::BytesMut;
use supaterm_host::protocol::{
    BUILD_IDENTITY, CAPABILITY_HOST_SHUTDOWN, ClientMessage, ClientRole, Command, CommandResult,
    Direction, ErrorCode, Frame, FrameDecoder, FrameKind, FrameReader, FrameWriter,
    GENERAL_FRAME_LIMIT, Hello, HostMessage, PrefaceDecoder, ProtocolLimits, Welcome,
    encode_preface,
};
use supaterm_host::transport::{
    BootstrapError, ClientError, PathEnvironment, ReferenceClient, RuntimePaths, ServerConfig,
    UnixServer, connect_or_start,
};
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::process::Command as ProcessCommand;

static DIRECTORY_ID: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(name: &str) -> Self {
        let sequence = DIRECTORY_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "supaterm-host-{name}-{}-{sequence}",
            std::process::id()
        ));
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(&path).unwrap();
        Self(path)
    }

    fn socket(&self) -> PathBuf {
        self.0.join("host.sock")
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct HeldServeLock(fs::File);

impl HeldServeLock {
    fn acquire(path: &Path) -> Self {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .unwrap();
        assert_eq!(unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) }, 0);
        file.set_permissions(fs::Permissions::from_mode(0o640))
            .unwrap();
        Self(file)
    }

    async fn wait_for_contender(&self) {
        for _ in 0..100 {
            if self.0.metadata().unwrap().permissions().mode() & 0o777 == 0o600 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("host launch did not reach the serve lock");
    }
}

async fn start_server(
    socket: &Path,
) -> (
    tokio::task::JoinHandle<Result<(), supaterm_host::transport::ServerError>>,
    PathBuf,
) {
    let paths = RuntimePaths::for_socket(socket).unwrap();
    let server = UnixServer::bind(ServerConfig::new(paths)).unwrap();
    let path = server.path().to_path_buf();
    (tokio::spawn(server.run()), path)
}

async fn raw_client(
    socket: &Path,
) -> (
    FrameReader<tokio::net::unix::OwnedReadHalf>,
    FrameWriter<tokio::net::unix::OwnedWriteHalf>,
) {
    let stream = UnixStream::connect(socket).await.unwrap();
    let (read, write) = stream.into_split();
    let mut reader = FrameReader::new(read, Direction::HostToClient);
    let mut writer = FrameWriter::new(write);
    writer.write_preface().await.unwrap();
    reader.read_preface().await.unwrap();
    (reader, writer)
}

async fn read_host_message<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut FrameReader<R>,
) -> HostMessage {
    reader
        .read_frame()
        .await
        .unwrap()
        .unwrap()
        .decode_json()
        .unwrap()
}

async fn stop_server(socket: &Path) {
    let mut client = ReferenceClient::connect(socket, Hello::new(ClientRole::Cli, "test-shutdown"))
        .await
        .unwrap();
    let response = client
        .request("shutdown-request", "shutdown-command", Command::Shutdown)
        .await
        .unwrap();
    assert!(matches!(
        response,
        HostMessage::Result {
            result: CommandResult::ShuttingDown,
            ..
        }
    ));
}

async fn invoke_stdio(socket: &Path, client_id: &str) -> std::process::Output {
    let mut child = ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"))
        .arg("stdio")
        .arg("--socket")
        .arg(socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let input = stdio_shutdown_input(client_id);
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(&input).await.unwrap();
    drop(stdin);
    tokio::time::timeout(Duration::from_secs(5), child.wait_with_output())
        .await
        .unwrap()
        .unwrap()
}

fn stdio_shutdown_input(client_id: &str) -> Vec<u8> {
    let hello = Frame::from_json(
        FrameKind::ClientControl,
        &ClientMessage::Hello(Hello::new(ClientRole::Cli, client_id)),
    )
    .unwrap();
    let shutdown = Frame::from_json(
        FrameKind::ClientControl,
        &ClientMessage::Command {
            request_id: "stdio-request".to_owned(),
            command_id: "stdio-command".to_owned(),
            command: Command::Shutdown,
        },
    )
    .unwrap();
    let mut input = Vec::from(encode_preface());
    input.extend_from_slice(&hello.encode());
    input.extend_from_slice(&shutdown.encode());
    input
}

fn assert_clean_stdio(output: &std::process::Output) {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let mut bytes = BytesMut::from(output.stdout.as_slice());
    assert_eq!(PrefaceDecoder::new().decode(&mut bytes).unwrap(), Some(()));
    let mut decoder = FrameDecoder::new(Direction::HostToClient);
    let mut messages = Vec::new();
    while let Some(frame) = decoder.decode(&mut bytes).unwrap() {
        messages.push(frame.decode_json::<HostMessage>().unwrap());
    }
    assert!(bytes.is_empty());
    assert_eq!(messages.len(), 2);
    assert!(matches!(messages[0], HostMessage::Welcome(_)));
    assert!(matches!(
        messages[1],
        HostMessage::Result {
            result: CommandResult::ShuttingDown,
            ..
        }
    ));
}

#[tokio::test]
async fn handshake_is_required_and_exact() {
    let directory = TestDirectory::new("handshake");
    let (server, socket) = start_server(&directory.socket()).await;

    let (mut reader, mut writer) = raw_client(&socket).await;
    writer
        .write_frame(
            &Frame::from_json(
                FrameKind::ClientControl,
                &ClientMessage::Command {
                    request_id: "request".to_owned(),
                    command_id: "command".to_owned(),
                    command: Command::Snapshot,
                },
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::HandshakeRequired,
                ..
            },
            ..
        }
    ));

    let (mut reader, mut writer) = raw_client(&socket).await;
    let mut wrong_version = Hello::new(ClientRole::Ui, "wrong-version");
    wrong_version.protocol_version += 1;
    writer
        .write_frame(
            &Frame::from_json(
                FrameKind::ClientControl,
                &ClientMessage::Hello(wrong_version),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::VersionMismatch,
                ..
            },
            ..
        }
    ));

    let (mut reader, mut writer) = raw_client(&socket).await;
    let mut wrong_build = Hello::new(ClientRole::Ui, "wrong-build");
    wrong_build.build_identity = format!("{BUILD_IDENTITY}-other");
    writer
        .write_frame(
            &Frame::from_json(FrameKind::ClientControl, &ClientMessage::Hello(wrong_build))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::BuildMismatch,
                ..
            },
            ..
        }
    ));

    let (mut reader, mut writer) = raw_client(&socket).await;
    let mut wrong_limits = Hello::new(ClientRole::Ui, "wrong-limits");
    wrong_limits.limits = ProtocolLimits {
        snapshot_bytes: 1,
        parser_continuation_bytes: 1,
    };
    writer
        .write_frame(
            &Frame::from_json(
                FrameKind::ClientControl,
                &ClientMessage::Hello(wrong_limits),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::LimitMismatch,
                ..
            },
            ..
        }
    ));

    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn reference_client_preserves_typed_handshake_rejections() {
    let directory = TestDirectory::new("typed-rejection");
    let paths = RuntimePaths::for_socket(directory.socket()).unwrap();
    let (server, socket) = start_server(&paths.socket).await;
    let mut wrong_build = Hello::new(ClientRole::Cli, "wrong-build-reference-client");
    wrong_build.build_identity = format!("{BUILD_IDENTITY}-other");

    let client_error = match ReferenceClient::connect(&socket, wrong_build.clone()).await {
        Ok(_) => panic!("mismatched build connected"),
        Err(error) => error,
    };
    assert!(matches!(
        client_error,
        ClientError::Rejected(supaterm_host::protocol::ProtocolFailure {
            code: ErrorCode::BuildMismatch,
            retryable: false,
            ..
        })
    ));

    let bootstrap_error = match connect_or_start(&paths, true, wrong_build).await {
        Ok(_) => panic!("mismatched build bootstrapped"),
        Err(error) => error,
    };
    assert!(matches!(
        bootstrap_error,
        BootstrapError::Client(ClientError::Rejected(
            supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::BuildMismatch,
                retryable: false,
                ..
            }
        ))
    ));

    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn near_limit_duplicate_capabilities_negotiate_once() {
    let directory = TestDirectory::new("cap-set");
    let (server, socket) = start_server(&directory.socket()).await;
    let (mut reader, mut writer) = raw_client(&socket).await;
    let mut hello = Hello::new(ClientRole::Cli, "duplicate-capabilities");
    hello.capabilities.clear();
    let empty = Frame::from_json(FrameKind::ClientControl, &ClientMessage::Hello(hello)).unwrap();
    let empty_array = empty
        .payload()
        .windows(2)
        .position(|window| window == b"[]")
        .unwrap();
    let capability = serde_json::to_vec(CAPABILITY_HOST_SHUTDOWN).unwrap();
    let fixed_length = empty.payload().len() - 2;
    let capability_count = (GENERAL_FRAME_LIMIT - fixed_length + 1) / (capability.len() + 1);
    let payload_length = fixed_length + capability_count * capability.len() + capability_count - 1;
    let mut payload = Vec::with_capacity(payload_length);
    payload.extend_from_slice(&empty.payload()[..=empty_array]);
    for index in 0..capability_count {
        if index > 0 {
            payload.push(b',');
        }
        payload.extend_from_slice(&capability);
    }
    payload.extend_from_slice(&empty.payload()[empty_array + 1..]);
    let frame = Frame::new(FrameKind::ClientControl, 0, payload).unwrap();
    assert!(GENERAL_FRAME_LIMIT - frame.payload().len() < capability.len() + 1);
    writer.write_frame(&frame).await.unwrap();

    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Welcome(Welcome { capabilities, .. })
            if capabilities == [CAPABILITY_HOST_SHUTDOWN]
    ));

    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn incomplete_handshake_releases_its_connection_slot_at_the_deadline() {
    let directory = TestDirectory::new("handshake-deadline");
    let paths = RuntimePaths::for_socket(directory.socket()).unwrap();
    let mut config = ServerConfig::new(paths);
    config.max_connections = 1;
    config.handshake_timeout = Duration::from_secs(1);
    let server = UnixServer::bind(config).unwrap();
    let shutdown = server.shutdown_handle();
    let socket = server.path().to_path_buf();
    let server = tokio::spawn(server.run());

    let (_first_reader, _first_writer) = raw_client(&socket).await;
    let second = UnixStream::connect(&socket).await.unwrap();
    let (second_read, second_write) = second.into_split();
    let mut second_reader = FrameReader::new(second_read, Direction::HostToClient);
    let mut second_writer = FrameWriter::new(second_write);
    second_writer.write_preface().await.unwrap();

    assert!(
        tokio::time::timeout(Duration::from_millis(100), second_reader.read_preface())
            .await
            .is_err()
    );
    tokio::time::timeout(Duration::from_secs(2), second_reader.read_preface())
        .await
        .unwrap()
        .unwrap();

    shutdown.request();
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn silent_preface_peer_does_not_block_server_shutdown() {
    let directory = TestDirectory::new("silent-shutdown");
    let paths = RuntimePaths::for_socket(directory.socket()).unwrap();
    let mut config = ServerConfig::new(paths);
    config.max_connections = 1;
    config.handshake_timeout = Duration::from_secs(30);
    config.drain_timeout = Duration::from_millis(100);
    let server = UnixServer::bind(config).unwrap();
    let shutdown = server.shutdown_handle();
    let socket = server.path().to_path_buf();
    let server = tokio::spawn(server.run());

    let mut first = UnixStream::connect(&socket).await.unwrap();
    first.write_all(&encode_preface()[..1]).await.unwrap();
    let second = UnixStream::connect(&socket).await.unwrap();
    let (second_read, second_write) = second.into_split();
    let mut second_reader = FrameReader::new(second_read, Direction::HostToClient);
    let mut second_writer = FrameWriter::new(second_write);
    second_writer.write_preface().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(100), second_reader.read_preface())
            .await
            .is_err()
    );

    shutdown.request();
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn shutdown_requires_the_cli_capability() {
    let directory = TestDirectory::new("capability");
    let (server, socket) = start_server(&directory.socket()).await;
    for role in [ClientRole::Ui, ClientRole::Ssh] {
        let mut client =
            ReferenceClient::connect(&socket, Hello::new(role, format!("unprivileged-{role:?}")))
                .await
                .unwrap();
        let response = client
            .request("shutdown-request", "shutdown-command", Command::Shutdown)
            .await
            .unwrap();
        assert!(matches!(
            response,
            HostMessage::Error {
                error: supaterm_host::protocol::ProtocolFailure {
                    code: ErrorCode::CapabilityRequired,
                    ..
                },
                ..
            }
        ));
    }
    let mut no_capability = Hello::new(ClientRole::Cli, "cli-without-capability");
    no_capability.capabilities.clear();
    let mut client = ReferenceClient::connect(&socket, no_capability)
        .await
        .unwrap();
    assert!(matches!(
        client
            .request("no-cap-request", "no-cap-command", Command::Shutdown)
            .await
            .unwrap(),
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::CapabilityRequired,
                ..
            },
            ..
        }
    ));
    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn invalid_direction_gets_one_typed_error_then_close() {
    let directory = TestDirectory::new("invalid-frame");
    let (server, socket) = start_server(&directory.socket()).await;
    let (mut reader, mut writer) = raw_client(&socket).await;
    writer
        .write_frame(&Frame::new(FrameKind::HostControl, 0, b"{}".to_vec()).unwrap())
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::InvalidFrame,
                ..
            },
            ..
        }
    ));
    assert!(
        tokio::time::timeout(Duration::from_secs(1), reader.read_frame())
            .await
            .unwrap()
            .unwrap()
            .is_none()
    );
    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn malformed_control_json_returns_a_typed_error() {
    let directory = TestDirectory::new("json");
    let (server, socket) = start_server(&directory.socket()).await;
    let (mut reader, mut writer) = raw_client(&socket).await;
    writer
        .write_frame(&Frame::new(FrameKind::ClientControl, 0, b"{".to_vec()).unwrap())
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::InvalidMessage,
                ..
            },
            ..
        }
    ));
    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn maximum_control_frame_with_an_invalid_identifier_gets_a_typed_error() {
    let directory = TestDirectory::new("max-id");
    let (server, socket) = start_server(&directory.socket()).await;
    let (mut reader, mut writer) = raw_client(&socket).await;
    writer
        .write_frame(
            &Frame::from_json(
                FrameKind::ClientControl,
                &ClientMessage::Hello(Hello::new(ClientRole::Cli, "maximum-frame")),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Welcome(_)
    ));

    let base = ClientMessage::Command {
        request_id: String::new(),
        command_id: "valid-command".to_owned(),
        command: Command::Ping,
    };
    let base_length = serde_json::to_vec(&base).unwrap().len();
    let request = ClientMessage::Command {
        request_id: "x".repeat(GENERAL_FRAME_LIMIT - base_length),
        command_id: "valid-command".to_owned(),
        command: Command::Ping,
    };
    let frame = Frame::from_json(FrameKind::ClientControl, &request).unwrap();
    assert_eq!(frame.payload().len(), GENERAL_FRAME_LIMIT);
    writer.write_frame(&frame).await.unwrap();

    assert!(matches!(
        read_host_message(&mut reader).await,
        HostMessage::Error {
            request_id: None,
            command_id: Some(command_id),
            error: supaterm_host::protocol::ProtocolFailure {
                code: ErrorCode::InvalidIdentifier,
                ..
            },
        } if command_id == "valid-command"
    ));

    stop_server(&socket).await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn duplicate_command_retry_across_reconnect_returns_the_first_result() {
    let directory = TestDirectory::new("dedupe");
    let (server, socket) = start_server(&directory.socket()).await;
    let hello = Hello::new(ClientRole::Cli, "stable-client");
    let mut first = ReferenceClient::connect(&socket, hello.clone())
        .await
        .unwrap();
    let first_response = first
        .request("request-1", "same-command", Command::Ping)
        .await
        .unwrap();
    drop(first);

    let mut second = ReferenceClient::connect(&socket, hello).await.unwrap();
    let retry_response = second
        .request("request-2", "same-command", Command::Ping)
        .await
        .unwrap();
    let next_response = second
        .request("request-3", "new-command", Command::Ping)
        .await
        .unwrap();
    assert!(matches!(
        first_response,
        HostMessage::Result {
            result: CommandResult::Pong {
                accepted_commands: 1
            },
            ..
        }
    ));
    assert!(matches!(
        retry_response,
        HostMessage::Result {
            request_id,
            result: CommandResult::Pong {
                accepted_commands: 1
            },
            ..
        } if request_id == "request-2"
    ));
    assert!(matches!(
        next_response,
        HostMessage::Result {
            result: CommandResult::Pong {
                accepted_commands: 2
            },
            ..
        }
    ));
    let snapshot = second
        .request("request-4", "snapshot-command", Command::Snapshot)
        .await
        .unwrap();
    assert!(matches!(
        snapshot,
        HostMessage::Result {
            result: CommandResult::Snapshot { snapshot }
            , ..
        } if snapshot.revision == 0
            && snapshot.structure_revision == 0
            && snapshot.workspace.spaces.is_empty()
            && snapshot.workspace.windows.is_empty()
    ));
    second
        .request("request-5", "shutdown", Command::Shutdown)
        .await
        .unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn foreground_serve_connects_and_shuts_down_cleanly() {
    let directory = TestDirectory::new("process");
    let socket = directory.socket();
    let mut child = ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"))
        .arg("serve")
        .arg("--foreground")
        .arg("--socket")
        .arg(&socket)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut client = None;
    for _ in 0..300 {
        match ReferenceClient::connect(&socket, Hello::new(ClientRole::Cli, "process-client")).await
        {
            Ok(connected) => {
                client = Some(connected);
                break;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
    let Some(mut client) = client else {
        child.kill().await.unwrap();
        panic!("foreground host did not become ready");
    };
    let response = client
        .request("request", "snapshot", Command::Snapshot)
        .await
        .unwrap();
    assert!(matches!(
        response,
        HostMessage::Result {
            result: CommandResult::Snapshot { .. },
            ..
        }
    ));
    client
        .request("stop-request", "stop-command", Command::Shutdown)
        .await
        .unwrap();
    drop(client);
    let output = tokio::time::timeout(Duration::from_secs(3), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
    assert!(!socket.exists());
}

#[tokio::test]
async fn stdio_stdout_contains_only_protocol_bytes() {
    let directory = TestDirectory::new("stdio");
    let (server, socket) = start_server(&directory.socket()).await;
    let output = invoke_stdio(&socket, "stdio-client").await;
    assert_clean_stdio(&output);
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn stdio_starts_the_host_on_demand_without_stdout_noise() {
    let directory = TestDirectory::new("stdio-bootstrap");
    let socket = directory.socket();
    let output = invoke_stdio(&socket, "stdio-bootstrap-client").await;
    assert_clean_stdio(&output);
    assert!(!socket.exists());
}

#[tokio::test]
async fn stdio_accepts_regular_file_input() {
    let directory = TestDirectory::new("stdio-file");
    let input_path = directory.0.join("input");
    fs::write(&input_path, stdio_shutdown_input("stdio-file-client")).unwrap();
    let (server, socket) = start_server(&directory.socket()).await;
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"))
            .arg("stdio")
            .arg("--socket")
            .arg(&socket)
            .stdin(Stdio::from(fs::File::open(input_path).unwrap()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_clean_stdio(&output);
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn stdio_exits_after_host_eof_while_stdin_remains_open() {
    let directory = TestDirectory::new("stdio-host-eof");
    let socket = directory.socket();
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let fake = tokio::spawn(async move {
        let mut hellos = Vec::new();
        for _ in 0..2 {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, write) = stream.into_split();
            let mut reader = FrameReader::new(read, Direction::ClientToHost);
            let mut writer = FrameWriter::new(write);
            reader.read_preface().await.unwrap();
            writer.write_preface().await.unwrap();
            let hello = reader
                .read_frame()
                .await
                .unwrap()
                .unwrap()
                .decode_json::<ClientMessage>()
                .unwrap();
            let ClientMessage::Hello(hello) = hello else {
                panic!("expected hello");
            };
            writer
                .write_frame(
                    &Frame::from_json(
                        FrameKind::HostControl,
                        &HostMessage::Welcome(Welcome {
                            protocol_version: hello.protocol_version,
                            build_identity: hello.build_identity.clone(),
                            host_id: "stdio-test-host".to_owned(),
                            epoch: "stdio-test-epoch".to_owned(),
                            revision: 0,
                            structure_revision: 0,
                            capabilities: Vec::new(),
                            limits: hello.limits,
                        }),
                    )
                    .unwrap(),
                )
                .await
                .unwrap();
            hellos.push(hello);
        }
        hellos
    });
    let mut command = ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"));
    command
        .arg("stdio")
        .arg("--socket")
        .arg(&socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().unwrap();
    let hello = Hello::new(ClientRole::Cli, "stdio-host-eof-client");
    let frame = Frame::from_json(
        FrameKind::ClientControl,
        &ClientMessage::Hello(hello.clone()),
    )
    .unwrap();
    let mut input = Vec::from(encode_preface());
    input.extend_from_slice(&frame.encode());
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(&input).await.unwrap();
    let output = tokio::time::timeout(Duration::from_secs(3), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    drop(stdin);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let hellos = fake.await.unwrap();
    assert_eq!(hellos.len(), 2);
    assert_eq!(hellos[0].role, ClientRole::Ssh);
    assert_eq!(hellos[1], hello);
}

#[tokio::test]
async fn sp_starts_the_host_on_demand() {
    let directory = TestDirectory::new("sp-bootstrap");
    let socket = directory.socket();
    let ping = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .arg("--socket")
        .arg(&socket)
        .arg("ping")
        .output()
        .await
        .unwrap();
    assert!(
        ping.status.success(),
        "{}",
        String::from_utf8_lossy(&ping.stderr)
    );
    let response: HostMessage = serde_json::from_slice(&ping.stdout).unwrap();
    assert!(matches!(
        response,
        HostMessage::Result {
            result: CommandResult::Pong { .. },
            ..
        }
    ));
    let shutdown = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .arg("--socket")
        .arg(&socket)
        .arg("shutdown")
        .output()
        .await
        .unwrap();
    assert!(
        shutdown.status.success(),
        "{}",
        String::from_utf8_lossy(&shutdown.stderr)
    );
    for _ in 0..300 {
        if !socket.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("host socket remained after shutdown");
}

#[tokio::test]
async fn parallel_cold_starts_join_the_winning_host_after_launchers_exit() {
    let directory = TestDirectory::new("parallel-bootstrap");
    let socket = directory.socket();
    let paths = RuntimePaths::for_socket(&socket).unwrap();
    let lock = HeldServeLock::acquire(&paths.serve_lock);

    let mut clients = Vec::new();
    for index in 0..8 {
        clients.push(
            ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
                .arg("--socket")
                .arg(&socket)
                .arg("--client-id")
                .arg(format!("parallel-{index}"))
                .arg("ping")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap(),
        );
    }

    lock.wait_for_contender().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    for client in &mut clients {
        assert!(client.try_wait().unwrap().is_none());
    }

    drop(lock);
    let mut server = ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"))
        .arg("serve")
        .arg("--foreground")
        .arg("--socket")
        .arg(&socket)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();

    for client in clients {
        let output = tokio::time::timeout(Duration::from_secs(5), client.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(matches!(
            serde_json::from_slice::<HostMessage>(&output.stdout).unwrap(),
            HostMessage::Result {
                result: CommandResult::Pong { .. },
                ..
            }
        ));
    }

    let mut client = ReferenceClient::connect(
        &socket,
        Hello::new(ClientRole::Cli, "parallel-bootstrap-shutdown"),
    )
    .await
    .unwrap();
    client
        .request("shutdown-request", "shutdown-command", Command::Shutdown)
        .await
        .unwrap();
    drop(client);
    let status = tokio::time::timeout(Duration::from_secs(3), server.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(status.success());
}

#[tokio::test]
async fn concurrent_serve_launchers_join_the_winning_host() {
    let directory = TestDirectory::new("parallel-serve");
    let socket = directory.socket();
    let paths = RuntimePaths::for_socket(&socket).unwrap();
    let lock = HeldServeLock::acquire(&paths.serve_lock);
    let mut launchers = Vec::new();
    for _ in 0..8 {
        launchers.push(
            ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"))
                .arg("serve")
                .arg("--socket")
                .arg(&socket)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap(),
        );
    }

    lock.wait_for_contender().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    for launcher in &mut launchers {
        assert!(launcher.try_wait().unwrap().is_none());
    }

    drop(lock);
    let mut server = ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"))
        .arg("serve")
        .arg("--foreground")
        .arg("--socket")
        .arg(&socket)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    for launcher in launchers {
        let output = tokio::time::timeout(Duration::from_secs(5), launcher.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }

    stop_server(&socket).await;
    let status = tokio::time::timeout(Duration::from_secs(3), server.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(status.success());
}

#[tokio::test]
async fn sp_connect_only_never_starts_a_host() {
    let directory = TestDirectory::new("sp-connect-only");
    let (server, socket) = start_server(&directory.socket()).await;
    let ping = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .arg("--connect-only")
        .arg("--socket")
        .arg(&socket)
        .arg("ping")
        .output()
        .await
        .unwrap();
    assert!(
        ping.status.success(),
        "{}",
        String::from_utf8_lossy(&ping.stderr)
    );
    assert!(matches!(
        serde_json::from_slice::<HostMessage>(&ping.stdout).unwrap(),
        HostMessage::Result {
            result: CommandResult::Pong { .. },
            ..
        }
    ));
    let shutdown = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .arg("--connect-only")
        .arg("--socket")
        .arg(&socket)
        .arg("shutdown")
        .output()
        .await
        .unwrap();
    assert!(
        shutdown.status.success(),
        "{}",
        String::from_utf8_lossy(&shutdown.stderr)
    );
    server.await.unwrap().unwrap();
    assert!(!socket.exists());
    let retry = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .arg("--connect-only")
        .arg("--socket")
        .arg(&socket)
        .arg("ping")
        .output()
        .await
        .unwrap();
    assert!(!retry.status.success());
    assert!(retry.stdout.is_empty());
    assert!(!retry.stderr.is_empty());
    assert!(!socket.exists());
}

#[tokio::test]
async fn reference_client_rejects_mismatched_response_ids() {
    let directory = TestDirectory::new("response-id");
    let socket = directory.socket();
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let fake = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, write) = stream.into_split();
        let mut reader = FrameReader::new(read, Direction::ClientToHost);
        let mut writer = FrameWriter::new(write);
        reader.read_preface().await.unwrap();
        writer.write_preface().await.unwrap();
        let hello = reader.read_frame().await.unwrap().unwrap();
        assert!(matches!(
            hello.decode_json::<ClientMessage>().unwrap(),
            ClientMessage::Hello(_)
        ));
        writer
            .write_frame(
                &Frame::from_json(
                    FrameKind::HostControl,
                    &HostMessage::Welcome(Welcome {
                        protocol_version: 1,
                        build_identity: BUILD_IDENTITY.to_owned(),
                        host_id: "fake-host".to_owned(),
                        epoch: "fake-epoch".to_owned(),
                        revision: 0,
                        structure_revision: 0,
                        capabilities: Vec::new(),
                        limits: ProtocolLimits::default(),
                    }),
                )
                .unwrap(),
            )
            .await
            .unwrap();
        let request = reader.read_frame().await.unwrap().unwrap();
        assert!(matches!(
            request.decode_json::<ClientMessage>().unwrap(),
            ClientMessage::Command { .. }
        ));
        writer
            .write_frame(
                &Frame::from_json(
                    FrameKind::HostControl,
                    &HostMessage::Result {
                        request_id: "wrong-request".to_owned(),
                        command_id: "wrong-command".to_owned(),
                        result: CommandResult::Pong {
                            accepted_commands: 1,
                        },
                    },
                )
                .unwrap(),
            )
            .await
            .unwrap();
    });
    let mut client =
        ReferenceClient::connect(&socket, Hello::new(ClientRole::Cli, "checked-client"))
            .await
            .unwrap();
    let error = client
        .request("right-request", "right-command", Command::Ping)
        .await
        .unwrap_err();
    assert!(matches!(error, ClientError::MismatchedResponse { .. }));
    fake.await.unwrap();
}

#[tokio::test]
async fn default_bootstrap_preserves_the_resolved_state_root() {
    let directory = TestDirectory::new("default-bootstrap");
    let state = directory.0.join("state");
    let runtime = directory.0.join("runtime");
    let home = directory.0.join("home");
    let ping = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .env("SUPATERM_STATE_HOME", &state)
        .env("XDG_RUNTIME_DIR", &runtime)
        .env("HOME", &home)
        .arg("ping")
        .output()
        .await
        .unwrap();
    assert!(
        ping.status.success(),
        "{}",
        String::from_utf8_lossy(&ping.stderr)
    );
    let paths = RuntimePaths::resolve_from(PathEnvironment {
        state_home: Some(state.into_os_string()),
        xdg_runtime_dir: Some(runtime.clone().into_os_string()),
        home: Some(home.clone().into_os_string()),
        temporary_directory: directory.0.join("temporary"),
        current_directory: directory.0.clone(),
        uid: unsafe { libc::getuid() },
    })
    .unwrap();
    let client = ReferenceClient::connect(
        &paths.socket,
        Hello::new(ClientRole::Cli, "default-bootstrap-check"),
    )
    .await
    .unwrap();
    assert_eq!(client.welcome.host_id, paths.host_id());
    drop(client);
    let shutdown = ProcessCommand::new(env!("CARGO_BIN_EXE_sp"))
        .env("SUPATERM_STATE_HOME", &paths.state_root)
        .env("XDG_RUNTIME_DIR", &runtime)
        .env("HOME", &home)
        .arg("shutdown")
        .output()
        .await
        .unwrap();
    assert!(
        shutdown.status.success(),
        "{}",
        String::from_utf8_lossy(&shutdown.stderr)
    );
    for _ in 0..300 {
        if !paths.socket.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("default host socket remained after shutdown");
}

#[tokio::test]
async fn bootstrap_times_out_on_a_silent_live_socket() {
    let directory = TestDirectory::new("silent-socket");
    let socket = directory.socket();
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let silent = tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
    });
    let mut command = ProcessCommand::new(env!("CARGO_BIN_EXE_supaterm-host"));
    command
        .arg("serve")
        .arg("--socket")
        .arg(&socket)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(3), command.output())
        .await
        .expect("bootstrap exceeded its deadline")
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    silent.abort();
}
