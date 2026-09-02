use std::time::Duration;
use supaterm_host::protocol::control::ClientId;
use supaterm_host::terminal::actor::{OutputEvent, TerminalError, TerminalRegistry};
use supaterm_host::terminal::pty::SpawnSpec;
use tokio::time::timeout;
use uuid::Uuid;

fn client(value: u128) -> ClientId {
    ClientId(Uuid::from_u128(value))
}

fn shell() -> SpawnSpec {
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

async fn read_until(
    attachment: &mut supaterm_host::terminal::actor::Attachment,
    needle: &[u8],
) -> Vec<u8> {
    timeout(Duration::from_secs(3), async {
        let mut bytes = Vec::new();
        while !bytes.windows(needle.len()).any(|window| window == needle) {
            match attachment.events.recv().await.unwrap() {
                OutputEvent::Output { bytes: next, .. } => bytes.extend_from_slice(&next),
                OutputEvent::Exited { .. } => panic!("terminal exited"),
                _ => {}
            }
        }
        bytes
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn detaching_every_client_keeps_the_same_process_alive() {
    let registry = TerminalRegistry::spawn();
    let pane = registry.create(shell()).await.unwrap();
    let first_client = client(1);
    let mut first = registry.attach(pane.id, first_client).await.unwrap();
    let first_generation = registry.claim_writer(pane.id, first_client).await.unwrap();
    registry
        .input(pane.id, first_client, first_generation, b"first\n".to_vec())
        .await
        .unwrap();
    read_until(&mut first, b"first DONE").await;

    registry.detach(pane.id, first_client).await.unwrap();
    assert_eq!(unsafe { libc::kill(pane.pid as i32, 0) }, 0);

    let second_client = client(2);
    let mut second = registry.attach(pane.id, second_client).await.unwrap();
    let second_generation = registry.claim_writer(pane.id, second_client).await.unwrap();
    registry
        .input(
            pane.id,
            second_client,
            second_generation,
            b"second\n".to_vec(),
        )
        .await
        .unwrap();
    read_until(&mut second, b"second DONE").await;
    assert_eq!(registry.info(pane.id).await.unwrap().pid, pane.pid);

    registry.close(pane.id).await.unwrap();
    assert_eq!(unsafe { libc::kill(pane.pid as i32, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[tokio::test]
async fn only_the_current_writer_generation_can_send_input() {
    let registry = TerminalRegistry::spawn();
    let pane = registry.create(shell()).await.unwrap();
    let first_client = client(1);
    let second_client = client(2);
    registry.attach(pane.id, first_client).await.unwrap();
    registry.attach(pane.id, second_client).await.unwrap();
    let first_generation = registry.claim_writer(pane.id, first_client).await.unwrap();
    let second_generation = registry.claim_writer(pane.id, second_client).await.unwrap();

    assert!(matches!(
        registry
            .input(pane.id, first_client, first_generation, b"old\n".to_vec())
            .await,
        Err(TerminalError::StaleWriter)
    ));
    registry
        .input(
            pane.id,
            second_client,
            second_generation,
            b"current\n".to_vec(),
        )
        .await
        .unwrap();

    registry.close(pane.id).await.unwrap();
}
