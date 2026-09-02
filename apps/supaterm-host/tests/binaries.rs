use bytes::BytesMut;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use supaterm_host::protocol::control::{
    ClientControl, ClientRole, CommandId, Limits, PROTOCOL_VERSION, current_build_identity,
    decode_host_control, encode_control,
};
use supaterm_host::protocol::frame::{Direction, Frame, FrameDecoder, FrameKind, PREFACE};
use tempfile::TempDir;
use uuid::Uuid;

struct RunningHost {
    child: Child,
    root: TempDir,
    socket: PathBuf,
}

impl RunningHost {
    fn start() -> Self {
        let root = tempfile::tempdir().unwrap();
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
