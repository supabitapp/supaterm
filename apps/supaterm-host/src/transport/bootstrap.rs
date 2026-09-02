use std::process::Stdio;
use std::time::Duration;

use thiserror::Error;

use crate::protocol::Hello;

use super::{ClientError, ReferenceClient, RuntimePaths};

struct Launcher(std::process::Child);

impl Launcher {
    fn spawn(command: &mut std::process::Command) -> Result<Self, std::io::Error> {
        command.spawn().map(Self)
    }

    fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, std::io::Error> {
        self.0.try_wait()
    }
}

impl Drop for Launcher {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub async fn connect_or_start(
    paths: &RuntimePaths,
    use_socket_override: bool,
    hello: Hello,
) -> Result<ReferenceClient, BootstrapError> {
    tokio::time::timeout(
        Duration::from_secs(5),
        connect_or_start_inner(paths, use_socket_override, hello),
    )
    .await
    .map_err(|_| BootstrapError::TimedOut)?
}

async fn connect_or_start_inner(
    paths: &RuntimePaths,
    use_socket_override: bool,
    hello: Hello,
) -> Result<ReferenceClient, BootstrapError> {
    match ReferenceClient::connect(&paths.socket, hello.clone()).await {
        Ok(client) => return Ok(client),
        Err(error @ ClientError::Rejected(_)) => return Err(error.into()),
        Err(_) => {}
    }
    let current = std::env::current_exe()?;
    let host = if current.file_name().and_then(|name| name.to_str()) == Some("supaterm-host") {
        current
    } else {
        let sibling = current.with_file_name("supaterm-host");
        let bundled = current
            .parent()
            .and_then(|directory| directory.parent())
            .map(|contents| contents.join("Helpers/supaterm-host"));
        bundled.filter(|path| path.is_file()).unwrap_or(sibling)
    };
    let mut command = std::process::Command::new(host);
    command.arg("serve");
    if use_socket_override {
        command.arg("--socket").arg(&paths.socket);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = Launcher::spawn(&mut command)?;
    let mut exit_status = None;
    for _ in 0..150 {
        if exit_status.is_none() {
            exit_status = child.try_wait()?;
        }
        match ReferenceClient::connect(&paths.socket, hello.clone()).await {
            Ok(client) => return Ok(client),
            Err(error @ ClientError::Rejected(_)) => return Err(error.into()),
            Err(_) => {}
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let exit_status = match exit_status {
        Some(status) => Some(status),
        None => child.try_wait()?,
    };
    match exit_status {
        Some(status) if !status.success() => Err(BootstrapError::StartFailed(status.to_string())),
        _ => Err(BootstrapError::TimedOut),
    }
}

#[derive(Debug, Error)]
pub enum BootstrapError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Client(#[from] ClientError),
    #[error("host start failed: {0}")]
    StartFailed(String),
    #[error("host did not become ready")]
    TimedOut,
}
