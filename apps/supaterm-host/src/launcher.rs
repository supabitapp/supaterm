use crate::protocol::control::{BuildIdentity, PROTOCOL_VERSION};
use crate::runtime::{ProcessRecord, RuntimePaths, SocketState};
use std::fs;
use std::io;
use std::time::{Duration, Instant};
use thiserror::Error;

const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const KILL_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Error)]
pub enum LauncherError {
    #[error("host process record is unsafe")]
    UnsafeProcessRecord,
    #[error("host did not stop")]
    StopTimeout,
    #[error(transparent)]
    Runtime(#[from] crate::runtime::RuntimeError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub async fn replace_mismatched_host(
    paths: &RuntimePaths,
    expected_build: &BuildIdentity,
) -> Result<bool, LauncherError> {
    let record = match fs::read(&paths.process_record) {
        Ok(bytes) => Some(serde_json::from_slice::<ProcessRecord>(&bytes)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let Some(record) = record else {
        return match paths.prepare_socket()? {
            SocketState::Live => Err(LauncherError::UnsafeProcessRecord),
            _ => Ok(false),
        };
    };
    let matches_build =
        record.protocol_version == PROTOCOL_VERSION && record.build == *expected_build;
    if record.still_matches() {
        if matches_build {
            return Ok(false);
        }
        stop_verified_host(&record).await?;
    } else if paths.prepare_socket()? == SocketState::Live {
        return Err(LauncherError::UnsafeProcessRecord);
    }
    remove_if_present(&paths.process_record)?;
    if !matches_build {
        remove_if_present(&paths.durable_state)?;
    }
    match paths.prepare_socket()? {
        SocketState::Live => Err(LauncherError::UnsafeProcessRecord),
        _ => Ok(!matches_build),
    }
}

pub async fn stop_verified_host(record: &ProcessRecord) -> Result<(), LauncherError> {
    if !record.still_matches() {
        return Err(LauncherError::UnsafeProcessRecord);
    }
    send_signal(record, libc::SIGTERM)?;
    if wait_for_exit(record, STOP_TIMEOUT).await {
        return Ok(());
    }
    if !record.still_matches() {
        return Ok(());
    }
    send_signal(record, libc::SIGKILL)?;
    if wait_for_exit(record, KILL_TIMEOUT).await {
        Ok(())
    } else {
        Err(LauncherError::StopTimeout)
    }
}

fn send_signal(record: &ProcessRecord, signal: i32) -> Result<(), LauncherError> {
    let result = unsafe { libc::kill(record.pid as i32, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error().into())
    }
}

async fn wait_for_exit(record: &ProcessRecord, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while record.still_matches() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    !record.still_matches()
}

fn remove_if_present(path: &std::path::Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::control::BuildIdentity;
    use crate::runtime::{PathConfiguration, RuntimePaths};
    use std::process::Command;
    use tempfile::TempDir;

    #[tokio::test]
    async fn stops_only_a_verified_process() {
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let record = ProcessRecord::for_process(child.id(), build("old")).unwrap();
        assert!(record.still_matches(), "{record:?}");
        stop_verified_host(&record).await.unwrap();
        assert!(child.wait().unwrap().code().is_none());
    }

    #[tokio::test]
    async fn mismatch_stops_host_and_resets_state() {
        let temporary = TempDir::new().unwrap();
        let paths = paths(&temporary);
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let record = ProcessRecord::for_process(child.id(), build("old")).unwrap();
        record.write(&paths.process_record).unwrap();
        fs::write(&paths.durable_state, b"old").unwrap();

        assert!(
            replace_mismatched_host(&paths, &build("new"))
                .await
                .unwrap()
        );
        assert!(!paths.process_record.exists());
        assert!(!paths.durable_state.exists());
        assert!(child.wait().unwrap().code().is_none());
    }

    #[tokio::test]
    async fn exact_host_is_left_untouched() {
        let temporary = TempDir::new().unwrap();
        let paths = paths(&temporary);
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let record = ProcessRecord::for_process(child.id(), build("same")).unwrap();
        record.write(&paths.process_record).unwrap();

        assert!(
            !replace_mismatched_host(&paths, &build("same"))
                .await
                .unwrap()
        );
        assert!(record.still_matches());
        unsafe { libc::kill(child.id() as i32, libc::SIGKILL) };
        child.wait().unwrap();
    }

    fn paths(temporary: &TempDir) -> RuntimePaths {
        RuntimePaths::initialize(PathConfiguration {
            state_home: Some(temporary.path().join("state")),
            home_directory: temporary.path().to_path_buf(),
            xdg_runtime_directory: Some(temporary.path().join("runtime")),
            temporary_directory: temporary.path().to_path_buf(),
            uid: unsafe { libc::geteuid() },
        })
        .unwrap()
    }

    fn build(fingerprint: &str) -> BuildIdentity {
        BuildIdentity {
            version: "1".into(),
            fingerprint: fingerprint.into(),
        }
    }
}
