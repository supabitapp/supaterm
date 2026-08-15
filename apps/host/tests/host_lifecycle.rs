use std::{
    collections::BTreeMap,
    os::unix::fs::{MetadataExt, PermissionsExt},
    process::Stdio,
    time::Duration,
};

use supaterm_host::{
    ClientRole, CommandSpec, EnvironmentSpec, HostClient, HostConfig, HostError, HostMessage,
    HostServer, ProcessExit, TerminalData, TerminalId, TerminalSize, TerminalStatus,
};
use tempfile::tempdir;
use tokio::{
    io::AsyncWriteExt,
    sync::{Mutex, MutexGuard, oneshot},
};

static HOST_TEST: Mutex<()> = Mutex::const_new(());

async fn isolate_host() -> MutexGuard<'static, ()> {
    HOST_TEST.lock().await
}

#[tokio::test]
async fn host_secures_roots_keeps_machine_identity_and_allows_one_instance() {
    let _isolation = isolate_host().await;
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let config = HostConfig::new(&runtime_root, &state_root);

    let first = HostServer::bind(config.clone()).await.unwrap();
    let first_machine_id = first.machine_id();

    let error = HostServer::bind(config.clone()).await.unwrap_err();
    assert!(matches!(error, HostError::AlreadyRunning));

    assert_eq!(
        std::fs::metadata(&runtime_root)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(first.socket_path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        std::fs::metadata(state_root.join("machine-id"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(std::fs::metadata(&runtime_root).unwrap().uid(), unsafe {
        libc::geteuid()
    });

    drop(first);

    let second = HostServer::bind(config).await.unwrap();
    assert_eq!(second.machine_id(), first_machine_id);
    assert_ne!(second.boot_id().to_string(), first_machine_id.to_string());
}

#[tokio::test]
async fn terminal_preserves_launch_values_and_reports_output_before_exit() {
    let _isolation = isolate_host().await;
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let working_directory = directory.path().join("working directory");
    std::fs::create_dir(&working_directory).unwrap();

    let server = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let mut client = HostClient::connect(&runtime_root.join("host.sock"), ClientRole::Test)
        .await
        .unwrap();

    let terminal_id = TerminalId::new();
    let command = CommandSpec {
        argv: vec![
            "/bin/sh".into(),
            "-c".into(),
            "IFS= read -r _; printf '<%s>|<%s>|<%s>\\n' \"$0\" \"$1\" \"$ONLY\"; pwd; exit 23"
                .into(),
            "zero value".into(),
            "one value".into(),
        ],
        cwd: working_directory.clone(),
        environment: EnvironmentSpec {
            inherit: false,
            set: BTreeMap::from([("ONLY".into(), "exact value".into())]),
            remove: Vec::new(),
        },
    };
    let created = client
        .create(terminal_id, command, TerminalSize::default())
        .await
        .unwrap();
    assert_eq!(created.id, terminal_id);

    let attachment = client.attach(terminal_id).await.unwrap();
    assert_eq!(attachment.terminal.next_sequence, 0);
    client
        .input(
            terminal_id,
            attachment.attachment_id,
            TerminalData::from(&b"continue\n"[..]),
        )
        .await
        .unwrap();

    let mut output = Vec::new();
    let exit = loop {
        let event = tokio::time::timeout(Duration::from_secs(5), client.next_event())
            .await
            .unwrap()
            .unwrap();
        match event {
            HostMessage::Output { sequence, data, .. } => {
                assert_eq!(sequence, output.len() as u64);
                output.extend(data.into_bytes());
            }
            HostMessage::Exited { exit, .. } => break exit,
            _ => panic!("unexpected host event"),
        }
    };
    let output = String::from_utf8(output).unwrap();
    assert!(output.contains("<zero value>|<one value>|<exact value>\r\n"));
    assert!(output.contains(&format!("{}\r\n", working_directory.display())));
    assert_eq!(exit, ProcessExit::Code(23));

    let terminal = client.get(terminal_id).await.unwrap();
    assert_eq!(
        terminal.status,
        TerminalStatus::Exited {
            exit: ProcessExit::Code(23)
        }
    );

    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}

#[tokio::test]
async fn create_is_idempotent_for_one_launch_and_rejects_identity_conflicts() {
    let _isolation = isolate_host().await;
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let server = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let client = HostClient::connect(&runtime_root.join("host.sock"), ClientRole::Test)
        .await
        .unwrap();
    let terminal_id = TerminalId::new();
    let command = CommandSpec {
        argv: vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()],
        cwd: directory.path().to_path_buf(),
        environment: EnvironmentSpec {
            inherit: true,
            ..EnvironmentSpec::default()
        },
    };

    let first = client
        .create(terminal_id, command.clone(), TerminalSize::default())
        .await
        .unwrap();
    let repeated = client
        .create(terminal_id, command, TerminalSize::default())
        .await
        .unwrap();
    assert_eq!(repeated, first);
    assert_eq!(client.list().await.unwrap(), vec![repeated]);

    let error = client
        .create(
            terminal_id,
            CommandSpec {
                argv: vec!["/usr/bin/true".into()],
                cwd: directory.path().to_path_buf(),
                environment: EnvironmentSpec::default(),
            },
            TerminalSize::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.remote_code(),
        Some(supaterm_host::ErrorCode::Conflict)
    );
    let invalid = client
        .create(
            TerminalId::new(),
            CommandSpec {
                argv: vec!["/usr/bin/true".into()],
                cwd: directory.path().join("missing"),
                environment: EnvironmentSpec::default(),
            },
            TerminalSize::default(),
        )
        .await
        .unwrap_err();
    assert_eq!(
        invalid.remote_code(),
        Some(supaterm_host::ErrorCode::InvalidRequest)
    );

    client.end(terminal_id).await.unwrap();
    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}

#[tokio::test]
async fn terminal_survives_disconnect_releases_controller_and_resizes() {
    let _isolation = isolate_host().await;
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let server = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let socket = runtime_root.join("host.sock");
    let terminal_id = TerminalId::new();
    let mut first = HostClient::connect(&socket, ClientRole::Test)
        .await
        .unwrap();
    first
        .create(
            terminal_id,
            CommandSpec {
                argv: vec![
                    "/bin/sh".into(),
                    "-c".into(),
                    "while IFS= read -r line; do if [ \"$line\" = size ]; then stty size; else printf '<%s>\\n' \"$line\"; fi; done".into(),
                ],
                cwd: directory.path().to_path_buf(),
                environment: EnvironmentSpec {
                    inherit: true,
                    ..EnvironmentSpec::default()
                },
            },
            TerminalSize::default(),
        )
        .await
        .unwrap();
    let first_attachment = first.attach(terminal_id).await.unwrap();
    let mut second = HostClient::connect(&socket, ClientRole::Test)
        .await
        .unwrap();
    let error = second.attach(terminal_id).await.unwrap_err();
    assert_eq!(
        error.remote_code(),
        Some(supaterm_host::ErrorCode::TerminalInUse)
    );
    first
        .detach(terminal_id, first_attachment.attachment_id)
        .await
        .unwrap();
    let second_attachment = second.attach(terminal_id).await.unwrap();
    second
        .detach(terminal_id, second_attachment.attachment_id)
        .await
        .unwrap();
    let first_attachment = first.attach(terminal_id).await.unwrap();

    first
        .input(
            terminal_id,
            first_attachment.attachment_id,
            TerminalData::from(&b"first\n"[..]),
        )
        .await
        .unwrap();
    let first_output = next_output(&mut first).await;
    assert!(String::from_utf8_lossy(&first_output).contains("first"));
    drop(first);

    let second_attachment = loop {
        match second.attach(terminal_id).await {
            Ok(attachment) => break attachment,
            Err(error) if error.remote_code() == Some(supaterm_host::ErrorCode::TerminalInUse) => {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Err(error) => panic!("reattach failed: {error}"),
        }
    };
    assert!(second_attachment.terminal.next_sequence > 0);
    second
        .resize(
            terminal_id,
            second_attachment.attachment_id,
            TerminalSize {
                rows: 41,
                cols: 103,
                pixel_width: 721,
                pixel_height: 533,
            },
        )
        .await
        .unwrap();
    second
        .input(
            terminal_id,
            second_attachment.attachment_id,
            TerminalData::from(&b"size\n"[..]),
        )
        .await
        .unwrap();

    let mut output = Vec::new();
    while !String::from_utf8_lossy(&output).contains("41 103") {
        output.extend(next_output(&mut second).await);
    }
    assert!(matches!(
        second.get(terminal_id).await.unwrap().status,
        TerminalStatus::Running
    ));

    second.end(terminal_id).await.unwrap();
    second.end(terminal_id).await.unwrap();
    let exit = loop {
        let event = tokio::time::timeout(Duration::from_secs(5), second.next_event())
            .await
            .unwrap()
            .unwrap();
        if let HostMessage::Exited { exit, .. } = event {
            break exit;
        }
    };
    assert!(matches!(
        exit,
        ProcessExit::Code(_) | ProcessExit::Signal(_)
    ));

    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}

#[tokio::test]
async fn attach_command_creates_relays_and_returns_the_child_exit_code() {
    let _isolation = isolate_host().await;
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let server = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let terminal_id = TerminalId::new();
    let mut process = tokio::process::Command::new(env!("CARGO_BIN_EXE_supaterm-host"))
        .arg("attach")
        .arg("--runtime-root")
        .arg(&runtime_root)
        .arg("--state-root")
        .arg(&state_root)
        .arg("--terminal")
        .arg(terminal_id.to_string())
        .arg("--cwd")
        .arg(directory.path())
        .arg("--clear-environment")
        .arg("--env")
        .arg("ONLY=from-cli")
        .arg("--")
        .arg("/bin/sh")
        .arg("-c")
        .arg("IFS= read -r line; printf '<%s>|<%s>\\n' \"$line\" \"$ONLY\"; exit 7")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = process.stdin.take().unwrap();
    stdin.write_all(b"through-host\n").await.unwrap();
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(5), process.wait_with_output())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(output.status.code(), Some(7));
    assert!(String::from_utf8_lossy(&output.stdout).contains("<through-host>|<from-cli>"));
    assert!(output.stderr.is_empty());

    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}

#[tokio::test]
async fn attach_command_ignores_fallback_argv_for_an_existing_terminal() {
    let _isolation = isolate_host().await;
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let server = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let terminal_id = TerminalId::new();
    let client = HostClient::connect(&runtime_root.join("host.sock"), ClientRole::Test)
        .await
        .unwrap();
    client
        .create(
            terminal_id,
            CommandSpec {
                argv: vec![
                    "/bin/sh".into(),
                    "-c".into(),
                    "IFS= read -r line; printf 'original:%s\\n' \"$line\"".into(),
                ],
                cwd: directory.path().to_path_buf(),
                environment: EnvironmentSpec {
                    inherit: true,
                    ..EnvironmentSpec::default()
                },
            },
            TerminalSize::default(),
        )
        .await
        .unwrap();

    let mut process = tokio::process::Command::new(env!("CARGO_BIN_EXE_supaterm-host"))
        .arg("attach")
        .arg("--runtime-root")
        .arg(&runtime_root)
        .arg("--state-root")
        .arg(&state_root)
        .arg("--terminal")
        .arg(terminal_id.to_string())
        .arg("--")
        .arg("/bin/sh")
        .arg("-c")
        .arg("printf 'fallback-was-run\\n'")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = process.stdin.take().unwrap();
    stdin.write_all(b"kept\n").await.unwrap();
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(5), process.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);

    assert!(output.status.success());
    assert!(stdout.contains("original:kept"));
    assert!(!stdout.contains("fallback-was-run"));
    assert!(output.stderr.is_empty());

    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}

async fn next_output(client: &mut HostClient) -> Vec<u8> {
    loop {
        let event = tokio::time::timeout(Duration::from_secs(5), client.next_event())
            .await
            .unwrap()
            .unwrap();
        if let HostMessage::Output { data, .. } = event {
            return data.into_bytes();
        }
    }
}
