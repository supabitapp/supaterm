use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;
use supaterm_host::protocol::control::ClientId;
use supaterm_host::terminal::actor::{Attachment, OutputEvent, TerminalError, TerminalRegistry};
use supaterm_host::terminal::pty::SpawnSpec;
use supaterm_host::terminal::vt::{HostTerminal, TerminalViewport};
use tempfile::TempDir;
use tokio::time::{sleep, timeout};
use uuid::Uuid;

fn client(value: u128) -> ClientId {
    ClientId(Uuid::from_u128(value))
}

fn shell(script: &str) -> SpawnSpec {
    SpawnSpec {
        argv: vec!["/bin/sh".into(), "-c".into(), script.into()],
        cwd: None,
        environment: vec![],
        rows: 24,
        columns: 80,
        pixel_width: 800,
        pixel_height: 480,
    }
}

async fn wait_for_output(
    registry: &TerminalRegistry,
    pane_id: supaterm_host::protocol::terminal::PaneId,
) {
    timeout(Duration::from_secs(3), async {
        while registry.info(pane_id).await.unwrap().output_sequence == 0 {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

async fn receive_snapshot(attachment: &mut Attachment) -> (u64, Vec<u8>) {
    let (snapshot_id, boundary) = match attachment.events.recv().await.unwrap() {
        OutputEvent::Attached {
            snapshot_id,
            boundary,
        } => (snapshot_id, boundary),
        event => panic!("expected attached, got {event:?}"),
    };
    let length = match attachment.events.recv().await.unwrap() {
        OutputEvent::SnapshotBegin {
            snapshot_id: actual,
            boundary: actual_boundary,
            length,
        } => {
            assert_eq!(actual, snapshot_id);
            assert_eq!(actual_boundary, boundary);
            length
        }
        event => panic!("expected snapshot begin, got {event:?}"),
    };
    let mut snapshot = Vec::with_capacity(length as usize);
    loop {
        match attachment.events.recv().await.unwrap() {
            OutputEvent::SnapshotChunk {
                snapshot_id: actual,
                offset,
                bytes,
            } => {
                assert_eq!(actual, snapshot_id);
                assert_eq!(offset, snapshot.len() as u64);
                snapshot.extend_from_slice(&bytes);
            }
            OutputEvent::SnapshotEnd {
                snapshot_id: actual,
                length: actual_length,
                sha256,
            } => {
                assert_eq!(actual, snapshot_id);
                assert_eq!(actual_length, length);
                assert_eq!(snapshot.len() as u64, length);
                assert_eq!(<[u8; 32]>::from(Sha256::digest(&snapshot)), sha256);
                break;
            }
            event => panic!("expected snapshot data, got {event:?}"),
        }
    }
    let next_sequence = match attachment.events.recv().await.unwrap() {
        OutputEvent::Ready { next_sequence } => next_sequence,
        event => panic!("expected ready, got {event:?}"),
    };
    assert_eq!(next_sequence, boundary);
    (next_sequence, snapshot)
}

#[tokio::test]
async fn attachment_receives_exact_snapshot_then_contiguous_live_output() {
    let registry = TerminalRegistry::spawn();
    let pane = registry
        .create(shell(
            r#"printf '\033]0;before\007before\n'; while read value; do printf '%s\n' "$value"; done"#,
        ))
        .await
        .unwrap();
    wait_for_output(&registry, pane.id).await;
    let client_id = client(1);
    let mut attachment = registry.attach(pane.id, client_id).await.unwrap();
    let (mut expected_sequence, snapshot) = receive_snapshot(&mut attachment).await;
    let terminal = HostTerminal::restore(
        &snapshot,
        TerminalViewport {
            rows: 24,
            columns: 80,
            cell_width: 10,
            cell_height: 20,
        },
    )
    .unwrap();
    assert_eq!(terminal.snapshot().unwrap(), snapshot);

    let generation = registry.claim_writer(pane.id, client_id).await.unwrap();
    registry
        .input(
            pane.id,
            client_id,
            generation,
            b"after-one\nafter-two\n".to_vec(),
        )
        .await
        .unwrap();
    let mut output = Vec::new();
    timeout(Duration::from_secs(3), async {
        while !output.windows(9).any(|bytes| bytes == b"after-two") {
            match attachment.events.recv().await.unwrap() {
                OutputEvent::Output { sequence, bytes } => {
                    assert_eq!(sequence, expected_sequence);
                    expected_sequence += bytes.len() as u64;
                    output.extend_from_slice(&bytes);
                }
                event => panic!("unexpected event after ready: {event:?}"),
            }
        }
    })
    .await
    .unwrap();
    registry.close(pane.id).await.unwrap();
}

#[tokio::test]
async fn headless_terminal_answers_program_queries_once() {
    let directory = TempDir::new().unwrap();
    let reply_path = directory.path().join("reply");
    let mut spec = shell(
        r#"stty raw -echo; printf '\033[6n'; dd bs=1 count=6 of="$REPLY_PATH" 2>/dev/null; sleep 30"#,
    );
    spec.environment.push((
        "REPLY_PATH".into(),
        reply_path.to_string_lossy().into_owned(),
    ));
    let registry = TerminalRegistry::spawn();
    let pane = registry.create(spec).await.unwrap();
    let reply = read_file(&reply_path).await;
    assert_eq!(reply, b"\x1b[1;1R");
    registry.close(pane.id).await.unwrap();
}

#[tokio::test]
async fn blocked_input_does_not_block_terminal_output() {
    let registry = TerminalRegistry::spawn();
    let pane = registry
        .create(shell(
            "stty raw -echo; printf 'READY'; sleep 2; printf 'OUTPUT'; sleep 30",
        ))
        .await
        .unwrap();
    wait_for_output(&registry, pane.id).await;
    let client_id = client(2);
    let mut attachment = registry.attach(pane.id, client_id).await.unwrap();
    let _ = receive_snapshot(&mut attachment).await;
    let generation = registry.claim_writer(pane.id, client_id).await.unwrap();
    let output = tokio::spawn(async move {
        loop {
            if let OutputEvent::Output { bytes, .. } = attachment.events.recv().await.unwrap()
                && bytes.windows(6).any(|bytes| bytes == b"OUTPUT")
            {
                break;
            }
        }
    });
    let input = vec![b'x'; 64 * 1024];
    let mut filled = false;
    for index in 0..1_000 {
        match registry
            .input(pane.id, client_id, generation, input.clone())
            .await
        {
            Ok(()) => {}
            Err(TerminalError::InputQueueFull) => {
                filled = true;
                break;
            }
            Err(error) => panic!("unexpected input error after {index} writes: {error}"),
        }
    }
    assert!(filled);
    timeout(Duration::from_secs(5), output)
        .await
        .unwrap()
        .unwrap();
    registry.close(pane.id).await.unwrap();
}

#[tokio::test]
async fn slow_observer_resnapshots_once_then_detaches_without_stalling_another_client() {
    let registry = TerminalRegistry::spawn();
    let pane = registry
        .create(shell(
            "read value; yes x | head -c 10000000; printf 'END'; sleep 30",
        ))
        .await
        .unwrap();
    let active_id = client(3);
    let slow_id = client(4);
    let mut active = registry.attach(pane.id, active_id).await.unwrap();
    let mut slow = registry.attach(pane.id, slow_id).await.unwrap();
    let (mut expected_sequence, _) = receive_snapshot(&mut active).await;
    let _ = receive_snapshot(&mut slow).await;
    let generation = registry.claim_writer(pane.id, active_id).await.unwrap();
    let active_reader = tokio::spawn(async move {
        let mut tail = Vec::new();
        loop {
            if let OutputEvent::Output { sequence, bytes } = active.events.recv().await.unwrap() {
                assert_eq!(sequence, expected_sequence);
                expected_sequence += bytes.len() as u64;
                tail.extend_from_slice(&bytes);
                if tail.len() > 32 {
                    tail.drain(..tail.len() - 32);
                }
                if tail.windows(3).any(|bytes| bytes == b"END") {
                    return;
                }
            }
        }
    });
    registry
        .input(pane.id, active_id, generation, b"go\n".to_vec())
        .await
        .unwrap();
    timeout(Duration::from_secs(10), active_reader)
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(3), async {
        loop {
            if registry.info(pane.id).await.unwrap().attachment_count == 1 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    registry.close(pane.id).await.unwrap();
}

async fn read_file(path: &PathBuf) -> Vec<u8> {
    timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(bytes) = tokio::fs::read(path).await
                && bytes.len() == 6
            {
                return bytes;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}
