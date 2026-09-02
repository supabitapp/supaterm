mod arguments;
mod dispatch;
mod output;
mod target;

use crate::client::{ClientConfiguration, ClientError, HostClient};
use crate::launcher::replace_mismatched_host;
use crate::protocol::control::{
    ClientRole, HostControl, ProtocolErrorCode, current_build_identity,
};
use crate::protocol::terminal::PaneId;
use crate::runtime::{PathConfiguration, RuntimePaths};
use anyhow::{Context, Result, bail};
use arguments::{AgentCommand, Arguments, Command};
use clap::Parser;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub async fn run() -> Result<()> {
    let arguments = Arguments::parse();
    match arguments.command {
        Command::Version => {
            let build = current_build_identity();
            println!("sp {} {}", build.version, build.fingerprint);
            Ok(())
        }
        Command::Ssh {
            term,
            ssh,
            arguments,
        } => replace_with_ssh(&term, &ssh, &arguments),
        Command::Agent {
            command: AgentCommand::Receive { kind },
        } => {
            let _ = receive_agent_hook(arguments.socket, kind).await;
            Ok(())
        }
        command => {
            let client = connect(arguments.socket).await?;
            let result =
                dispatch::dispatch(&client, command, arguments.expected_structure_revision).await?;
            output::emit(result, arguments.json, arguments.plain, arguments.quiet)
        }
    }
}

async fn connect(explicit_socket: Option<PathBuf>) -> Result<HostClient> {
    let paths = paths(explicit_socket.clone())?;
    let configuration = || ClientConfiguration {
        socket: paths.socket.clone(),
        build: current_build_identity(),
        role: ClientRole::Cli,
        client_id: None,
        capabilities: vec![
            "semantic_state".into(),
            "terminal_snapshot".into(),
            "host_targeting".into(),
        ],
    };
    match HostClient::connect(configuration()).await {
        Ok(client) => return Ok(client),
        Err(error) if explicit_socket.is_some() => return Err(error.into()),
        Err(error) if is_protocol_mismatch(&error) => {
            replace_mismatched_host(&paths, &current_build_identity()).await?;
        }
        Err(_) => {}
    }
    launch_host(&paths)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match HostClient::connect(configuration()).await {
            Ok(client) => return Ok(client),
            Err(error) if Instant::now() >= deadline => return Err(error.into()),
            Err(_) => tokio::time::sleep(Duration::from_millis(25)).await,
        }
    }
}

fn paths(explicit_socket: Option<PathBuf>) -> Result<RuntimePaths> {
    let mut paths = RuntimePaths::initialize(PathConfiguration::from_environment()?)?;
    if let Some(socket) =
        explicit_socket.or_else(|| std::env::var_os("SUPATERM_HOST_SOCKET_PATH").map(PathBuf::from))
    {
        paths.socket = socket;
    }
    Ok(paths)
}

fn launch_host(paths: &RuntimePaths) -> Result<()> {
    let executable = host_executable()?;
    let status = ProcessCommand::new(executable)
        .arg("serve")
        .arg("--socket")
        .arg(&paths.socket)
        .status()
        .context("start supaterm-host")?;
    if !status.success() {
        bail!("supaterm-host failed to start");
    }
    Ok(())
}

fn host_executable() -> Result<PathBuf> {
    let current = std::env::current_exe()?;
    let directory = current.parent().context("sp has no parent directory")?;
    let candidates = [
        directory.join("supaterm-host"),
        directory.join("../Helpers/supaterm-host"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.canonicalize())
        .transpose()?
        .context("supaterm-host is not installed beside sp")
}

fn is_protocol_mismatch(error: &ClientError) -> bool {
    matches!(
        error,
        ClientError::ExpectedWelcome(response)
            if matches!(
                response.as_ref(),
                HostControl::Error { error, .. }
                    if error.code == ProtocolErrorCode::ProtocolMismatch
            )
    )
}

async fn receive_agent_hook(socket: Option<PathBuf>, kind: String) -> Result<()> {
    let pane_id = std::env::var("SUPATERM_PANE_ID")
        .context("SUPATERM_PANE_ID is not set")?
        .parse::<Uuid>()
        .map(PaneId)?;
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 1024 * 1024 {
        return Ok(());
    }
    let hook: AgentHook = serde_json::from_slice(&bytes)?;
    if hook.hook_event_name != "SessionStart" || hook.agent_id.is_some() {
        return Ok(());
    }
    let Some(native_session_id) = hook.session_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let client = connect(socket).await?;
    let _ = client
        .request(
            "agent.session_start",
            json!({
                "pane_id": pane_id,
                "kind": kind,
                "native_session_id": native_session_id,
                "working_directory": hook.cwd,
                "command_arguments": Value::Null
            }),
        )
        .await;
    Ok(())
}

fn replace_with_ssh(term: &str, ssh: &str, arguments: &[String]) -> Result<()> {
    if term.trim().is_empty() {
        bail!("--term requires a value");
    }
    let error = ProcessCommand::new(ssh)
        .args(arguments)
        .env("TERM", term)
        .env("COLORTERM", "truecolor")
        .exec();
    Err(error).context("launch ssh")
}

#[derive(Deserialize)]
struct AgentHook {
    hook_event_name: String,
    session_id: Option<String>,
    cwd: Option<PathBuf>,
    agent_id: Option<String>,
}
