use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Read;
use std::path::PathBuf;
use supaterm_host::client::{ClientConfiguration, HostClient};
use supaterm_host::protocol::control::{ClientRole, current_build_identity};
use supaterm_host::runtime::{PathConfiguration, RuntimePaths};

#[derive(Parser)]
#[command(name = "sp")]
struct Arguments {
    #[arg(long, global = true)]
    socket: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
    Snapshot,
    Version,
}

#[derive(Subcommand)]
enum AgentCommand {
    Receive {
        #[arg(long)]
        kind: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let arguments = Arguments::parse();
    match arguments.command {
        Command::Agent {
            command: AgentCommand::Receive { kind },
        } => {
            let _ = receive_agent_hook(arguments.socket, kind).await;
        }
        Command::Version => {
            let build = current_build_identity();
            println!("sp {} {}", build.version, build.fingerprint);
        }
        Command::Snapshot => {
            let mut paths = RuntimePaths::initialize(PathConfiguration::from_environment()?)?;
            if let Some(socket) = arguments.socket {
                paths.socket = socket;
            }
            let client = HostClient::connect(ClientConfiguration {
                socket: paths.socket,
                build: current_build_identity(),
                role: ClientRole::Cli,
                client_id: None,
                capabilities: vec!["semantic_state".into()],
            })
            .await?;
            let snapshot = client.request("state.snapshot", Value::Null).await?;
            println!("{}", serde_json::to_string(&snapshot)?);
        }
    }
    Ok(())
}

async fn receive_agent_hook(socket: Option<PathBuf>, kind: String) -> Result<()> {
    let pane_id = std::env::var("SUPATERM_PANE_ID")
        .context("SUPATERM_PANE_ID is not set")?
        .parse::<uuid::Uuid>()
        .map(supaterm_host::protocol::terminal::PaneId)?;
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
    let client = HostClient::connect(ClientConfiguration {
        socket: socket_path(socket)?,
        build: current_build_identity(),
        role: ClientRole::Hook,
        client_id: None,
        capabilities: Vec::new(),
    })
    .await?;
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

fn socket_path(explicit: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(socket) = explicit {
        return Ok(socket);
    }
    if let Some(socket) = std::env::var_os("SUPATERM_HOST_SOCKET_PATH") {
        return Ok(socket.into());
    }
    Ok(RuntimePaths::initialize(PathConfiguration::from_environment()?)?.socket)
}

#[derive(Deserialize)]
struct AgentHook {
    hook_event_name: String,
    session_id: Option<String>,
    cwd: Option<PathBuf>,
    agent_id: Option<String>,
}
