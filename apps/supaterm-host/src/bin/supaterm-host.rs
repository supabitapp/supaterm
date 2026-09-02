use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command as ProcessCommand, Stdio};
use supaterm_host::protocol::control::{PROTOCOL_VERSION, current_build_identity};
use supaterm_host::runtime::{PathConfiguration, RuntimePaths};

#[derive(Parser)]
#[command(name = "supaterm-host")]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(long)]
        socket: Option<PathBuf>,
        #[arg(long)]
        foreground: bool,
    },
    Stdio {
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    Version,
}

fn main() -> Result<()> {
    let arguments = Arguments::parse();
    if let Command::Serve {
        socket,
        foreground: false,
    } = &arguments.command
    {
        return launch_detached(socket.as_ref());
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(arguments.command))
}

fn launch_detached(socket: Option<&PathBuf>) -> Result<()> {
    let mut command = ProcessCommand::new(std::env::current_exe()?);
    command.arg("serve").arg("--foreground");
    if let Some(socket) = socket {
        command.arg("--socket").arg(socket);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.spawn().context("start detached host")?;
    Ok(())
}

async fn run(command: Command) -> Result<()> {
    match command {
        Command::Version => {
            let build = current_build_identity();
            println!(
                "supaterm-host {} protocol {} {}",
                build.version, PROTOCOL_VERSION, build.fingerprint
            );
        }
        Command::Serve { socket, .. } => {
            let paths = paths(socket)?;
            supaterm_host::server::serve(paths, current_build_identity()).await?;
        }
        Command::Stdio { socket } => {
            let paths = paths(socket)?;
            supaterm_host::transport::stdio::bridge(&paths.socket).await?;
        }
    }
    Ok(())
}

fn paths(socket: Option<PathBuf>) -> Result<RuntimePaths> {
    let mut paths = RuntimePaths::initialize(PathConfiguration::from_environment()?)?;
    if let Some(socket) = socket {
        paths.socket = socket;
    }
    Ok(paths)
}
