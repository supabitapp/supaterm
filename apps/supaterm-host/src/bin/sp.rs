use anyhow::Result;
use clap::{Parser, Subcommand};
use serde_json::Value;
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
    Snapshot,
    Version,
}

#[tokio::main]
async fn main() -> Result<()> {
    let arguments = Arguments::parse();
    match arguments.command {
        Command::Version => {
            let build = current_build_identity();
            println!("sp {} {}", build.version, build.fingerprint);
        }
        Command::Snapshot => {
            let mut paths = RuntimePaths::initialize(PathConfiguration::from_environment()?)?;
            if let Some(socket) = arguments.socket {
                paths.socket = socket;
            }
            let mut client = HostClient::connect(ClientConfiguration {
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
