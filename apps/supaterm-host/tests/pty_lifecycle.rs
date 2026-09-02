use std::path::PathBuf;
use std::time::Duration;
use supaterm_host::terminal::pty::{Pty, SpawnError, SpawnSpec};
use tokio::time::timeout;

fn direct(command: &str) -> SpawnSpec {
    SpawnSpec {
        argv: vec!["/bin/sh".into(), "-c".into(), command.into()],
        cwd: None,
        environment: vec![],
        rows: 24,
        columns: 80,
        pixel_width: 800,
        pixel_height: 480,
    }
}

async fn read_until(pty: &Pty, needle: &[u8]) -> Vec<u8> {
    timeout(Duration::from_secs(3), async {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        while !output.windows(needle.len()).any(|window| window == needle) {
            let count = pty.read(&mut buffer).await.unwrap();
            assert_ne!(count, 0);
            output.extend_from_slice(&buffer[..count]);
        }
        output
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn pty_supports_input_output_and_resize() {
    let (pty, mut child) = Pty::spawn(&direct(
        "printf 'READY\\n'; read value; stty size; printf '%s DONE\\n' \"$value\"; sleep 30",
    ))
    .unwrap();
    assert_eq!(pty.pid(), child.id());
    read_until(&pty, b"READY").await;

    pty.resize(31, 97, 970, 620).unwrap();
    pty.write_all(b"hello\n").await.unwrap();
    let output = read_until(&pty, b"DONE").await;

    assert!(output.windows(5).any(|window| window == b"31 97"));
    pty.terminate_process_group().unwrap();
    let status = tokio::task::spawn_blocking(move || child.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(!status.success());
}

#[tokio::test]
async fn explicit_termination_kills_the_full_process_group() {
    let (pty, mut child) = Pty::spawn(&direct("sleep 30 & printf '%s\\n' \"$!\"; wait")).unwrap();
    let output = read_until(&pty, b"\n").await;
    let descendant = String::from_utf8_lossy(&output)
        .trim()
        .parse::<i32>()
        .unwrap();

    pty.terminate_process_group().unwrap();
    tokio::task::spawn_blocking(move || child.wait())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(unsafe { libc::kill(descendant, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[test]
fn missing_directory_and_program_have_distinct_errors() {
    let missing_directory = SpawnSpec {
        cwd: Some(PathBuf::from("/definitely/missing/supaterm-directory")),
        ..direct("true")
    };
    assert!(matches!(
        Pty::spawn(&missing_directory),
        Err(SpawnError::WorkingDirectoryNotFound(_))
    ));

    let missing_program = SpawnSpec {
        argv: vec!["/definitely/missing/supaterm-program".into()],
        ..direct("true")
    };
    assert!(matches!(
        Pty::spawn(&missing_program),
        Err(SpawnError::ExecutableNotFound(_))
    ));
}
