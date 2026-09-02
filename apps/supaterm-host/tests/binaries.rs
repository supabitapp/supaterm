use bytes::BytesMut;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use supaterm_host::client::{ClientConfiguration, HostClient};
use supaterm_host::protocol::control::HostId;
use supaterm_host::protocol::control::{
    ClientControl, ClientRole, CommandId, Limits, PROTOCOL_VERSION, current_build_identity,
    decode_host_control, encode_control,
};
use supaterm_host::protocol::frame::{Direction, Frame, FrameDecoder, FrameKind, PREFACE};
use supaterm_host::protocol::terminal::PaneId;
use supaterm_host::workspace::model::{
    Placement, RootPlacement, SpaceId, TabId, WindowId, Workspace,
};
use supaterm_host::workspace::persistence::DurableDocument;
use supaterm_host::workspace::reducer::{Command as WorkspaceCommand, apply};
use tempfile::TempDir;
use uuid::Uuid;

struct RunningHost {
    child: Child,
    root: TempDir,
    socket: PathBuf,
}

impl RunningHost {
    fn start() -> Self {
        Self::start_at(tempfile::tempdir().unwrap())
    }

    fn start_at(root: TempDir) -> Self {
        let socket = root.path().join("host.sock");
        let child = Command::new(assert_cmd::cargo::cargo_bin!("supaterm-host"))
            .args(["serve", "--foreground", "--socket"])
            .arg(&socket)
            .env("SUPATERM_STATE_HOME", root.path().join("state"))
            .env("XDG_RUNTIME_DIR", root.path().join("run"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !socket.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(socket.exists());
        Self {
            child,
            root,
            socket,
        }
    }
}

#[test]
fn cold_start_restores_logical_panes_as_safe_shells() {
    let root = tempfile::tempdir().unwrap();
    let state_directory = root.path().join("state");
    std::fs::create_dir_all(&state_directory).unwrap();
    let space_id = SpaceId(Uuid::from_u128(1));
    let window_id = WindowId(Uuid::from_u128(2));
    let tab_id = TabId(Uuid::from_u128(3));
    let pane_id = PaneId(Uuid::from_u128(4));
    let mut workspace = Workspace::new(space_id, window_id, "Space 1".into());
    apply(
        &mut workspace,
        &mut [],
        WorkspaceCommand::CreateTab {
            window_id,
            space_id,
            tab_id,
            pane_id,
            placement: Placement::Root(RootPlacement {
                pinned: false,
                index: 0,
            }),
            title: Some("Saved".into()),
            restart_directory: Some(root.path().to_path_buf()),
        },
    )
    .unwrap();
    let document = DurableDocument::new(HostId(Uuid::from_u128(5)), workspace, Vec::new());
    std::fs::write(
        state_directory.join("host-state.json"),
        serde_json::to_vec(&document).unwrap(),
    )
    .unwrap();
    let host = RunningHost::start_at(root);
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let panes = runtime.block_on(async {
        let client = HostClient::connect(ClientConfiguration {
            socket: host.socket.clone(),
            build: current_build_identity(),
            role: ClientRole::Cli,
            client_id: None,
            capabilities: vec!["terminal_snapshot".into()],
        })
        .await
        .unwrap();
        client.list_terminals().await.unwrap()
    });
    assert_eq!(panes.len(), 1);
    assert_eq!(panes[0].id, pane_id);
}

impl Drop for RunningHost {
    fn drop(&mut self) {
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGTERM);
        }
        let status = self.child.wait().unwrap();
        assert!(status.success());
        assert!(!self.socket.exists());
        assert!(self.root.path().join("state/host-state.json").exists());
    }
}

#[test]
fn version_is_one_stdout_line() {
    let output = Command::new(assert_cmd::cargo::cargo_bin!("supaterm-host"))
        .arg("version")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(String::from_utf8(output.stdout).unwrap().lines().count(), 1);
}

#[test]
fn describe_reports_the_canonical_runtime_and_build() {
    let root = tempfile::tempdir().unwrap();
    let output = Command::new(assert_cmd::cargo::cargo_bin!("supaterm-host"))
        .arg("describe")
        .env("SUPATERM_STATE_HOME", root.path().join("state"))
        .env("XDG_RUNTIME_DIR", root.path().join("run"))
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let description: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(description["protocol_version"], PROTOCOL_VERSION);
    assert_eq!(
        description["build"],
        serde_json::to_value(current_build_identity()).unwrap()
    );
    assert_eq!(
        description["state_root"].as_str().unwrap(),
        root.path()
            .join("state")
            .canonicalize()
            .unwrap()
            .to_str()
            .unwrap()
    );
    assert!(
        description["socket"]
            .as_str()
            .unwrap()
            .ends_with("/host.sock")
    );
}

#[test]
fn rust_sp_reads_the_empty_host_snapshot() {
    let host = RunningHost::start();

    let output = Command::new(assert_cmd::cargo::cargo_bin!("sp"))
        .args(["--socket", host.socket.to_str().unwrap(), "snapshot"])
        .env("SUPATERM_STATE_HOME", host.root.path().join("state"))
        .env("XDG_RUNTIME_DIR", host.root.path().join("run"))
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["revision"], 0);
}

#[test]
fn rust_sp_mutates_and_reads_host_owned_settings_and_workspace() {
    let host = RunningHost::start();
    let sp = assert_cmd::cargo::cargo_bin!("sp");
    let environment = [
        ("SUPATERM_STATE_HOME", host.root.path().join("state")),
        ("XDG_RUNTIME_DIR", host.root.path().join("run")),
    ];
    let renamed = Command::new(sp)
        .args([
            "--socket",
            host.socket.to_str().unwrap(),
            "--json",
            "space",
            "rename",
            "Headless",
            "00000000-0000-0000-0000-000000000001",
        ])
        .envs(environment.clone())
        .output()
        .unwrap();
    assert!(
        renamed.status.success(),
        "{}",
        String::from_utf8_lossy(&renamed.stderr)
    );
    let configured = Command::new(sp)
        .args([
            "--socket",
            host.socket.to_str().unwrap(),
            "config",
            "set",
            "terminal.scrollback_lines",
            "60000",
        ])
        .envs(environment.clone())
        .output()
        .unwrap();
    assert!(
        configured.status.success(),
        "{}",
        String::from_utf8_lossy(&configured.stderr)
    );
    let snapshot = Command::new(sp)
        .args(["--socket", host.socket.to_str().unwrap(), "snapshot"])
        .envs(environment)
        .output()
        .unwrap();
    let snapshot: serde_json::Value = serde_json::from_slice(&snapshot.stdout).unwrap();
    assert_eq!(snapshot["workspace"]["spaces"][0]["name"], "Headless");
}

#[test]
fn rust_sp_bootstraps_the_local_host() {
    let root = tempfile::tempdir().unwrap();
    let state = root.path().join("state");
    let run = root.path().join("run");
    let output = Command::new(assert_cmd::cargo::cargo_bin!("sp"))
        .arg("snapshot")
        .env("SUPATERM_STATE_HOME", &state)
        .env("XDG_RUNTIME_DIR", &run)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let snapshot: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(snapshot["workspace"]["spaces"][0]["name"], "Space 1");

    let paths = supaterm_host::runtime::RuntimePaths::initialize(
        supaterm_host::runtime::PathConfiguration {
            state_home: Some(state),
            home_directory: root.path().join("home"),
            xdg_runtime_directory: Some(run),
            temporary_directory: root.path().join("tmp"),
            uid: unsafe { libc::geteuid() },
        },
    )
    .unwrap();
    let record: supaterm_host::runtime::ProcessRecord =
        serde_json::from_slice(&std::fs::read(&paths.process_record).unwrap()).unwrap();
    assert!(record.still_matches());
    assert_eq!(unsafe { libc::kill(record.pid as i32, libc::SIGTERM) }, 0);
    let deadline = Instant::now() + Duration::from_secs(5);
    while paths.socket.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(!paths.socket.exists());
}

#[test]
fn stdio_stdout_contains_only_host_frames() {
    let host = RunningHost::start();
    let mut bridge = Command::new(assert_cmd::cargo::cargo_bin!("supaterm-host"))
        .args(["stdio", "--socket", host.socket.to_str().unwrap()])
        .env("SUPATERM_STATE_HOME", host.root.path().join("state"))
        .env("XDG_RUNTIME_DIR", host.root.path().join("run"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let command_id = CommandId(Uuid::new_v4());
    let mut input = BytesMut::from(PREFACE.as_slice());
    append_control(
        &mut input,
        ClientControl::Hello {
            protocol_version: PROTOCOL_VERSION,
            build: current_build_identity(),
            role: ClientRole::Cli,
            client_id: None,
            capabilities: vec!["semantic_state".into()],
            limits: Limits::default(),
        },
    );
    append_control(
        &mut input,
        ClientControl::Request {
            command_id,
            method: "state.snapshot".into(),
            params: serde_json::Value::Null,
        },
    );
    bridge.stdin.take().unwrap().write_all(&input).unwrap();
    let mut output = Vec::new();
    bridge
        .stdout
        .take()
        .unwrap()
        .read_to_end(&mut output)
        .unwrap();
    let result = bridge.wait_with_output().unwrap();

    assert!(result.status.success());
    assert!(result.stderr.is_empty());
    let mut bytes = BytesMut::from(output.as_slice());
    let mut decoder = FrameDecoder::new(Direction::HostToClient);
    let welcome = decoder.decode(&mut bytes).unwrap().unwrap();
    let response = decoder.decode(&mut bytes).unwrap().unwrap();
    assert!(matches!(
        decode_host_control(&welcome.payload).unwrap(),
        supaterm_host::protocol::control::HostControl::Welcome { .. }
    ));
    assert!(matches!(
        decode_host_control(&response.payload).unwrap(),
        supaterm_host::protocol::control::HostControl::Result {
            command_id: response_id,
            ..
        } if response_id == command_id
    ));
    assert!(bytes.is_empty());
}

fn append_control(destination: &mut BytesMut, control: ClientControl) {
    Frame {
        kind: FrameKind::ClientControl,
        stream_id: 0,
        payload: encode_control(&control).unwrap().into(),
    }
    .encode(destination)
    .unwrap();
}
