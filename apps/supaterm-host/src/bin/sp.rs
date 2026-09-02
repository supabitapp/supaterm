use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

use supaterm_host::protocol::{BUILD_VERSION, ClientRole, Command, Hello, HostMessage};
use supaterm_host::random_identifier;
use supaterm_host::transport::{ReferenceClient, RuntimePaths, connect_or_start};

const HELP: &str = "Usage:\n  sp [--connect-only] [--socket PATH] [--client-id ID] snapshot\n  sp [--connect-only] [--socket PATH] [--client-id ID] ping\n  sp [--connect-only] [--socket PATH] [--client-id ID] shutdown\n  sp version\n  sp --help";

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("sp: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), String> {
    let arguments: Vec<OsString> = env::args_os().skip(1).collect();
    if matches!(
        arguments.first().and_then(|argument| argument.to_str()),
        Some("--help" | "-h" | "help")
    ) {
        println!("{HELP}");
        return Ok(());
    }
    if matches!(
        arguments.first().and_then(|argument| argument.to_str()),
        Some("version" | "--version" | "-V")
    ) {
        if arguments.len() != 1 {
            return Err("version takes no arguments".to_owned());
        }
        println!("sp {BUILD_VERSION}");
        return Ok(());
    }
    let parsed = parse(arguments)?;
    let use_socket_override = parsed.socket.is_some();
    let paths = match parsed.socket {
        Some(socket) => RuntimePaths::for_socket(socket),
        None => RuntimePaths::resolve(),
    }
    .map_err(|error| error.to_string())?;
    let client_id = parsed
        .client_id
        .unwrap_or_else(|| format!("sp-{}", unsafe { libc::getuid() }));
    let hello = Hello::new(ClientRole::Cli, client_id);
    let mut client = if parsed.connect_only {
        ReferenceClient::connect(&paths.socket, hello)
            .await
            .map_err(|error| error.to_string())?
    } else {
        connect_or_start(&paths, use_socket_override, hello)
            .await
            .map_err(|error| error.to_string())?
    };
    let response = client
        .request(
            random_identifier("request"),
            random_identifier("command"),
            parsed.command,
        )
        .await
        .map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&response).map_err(|error| error.to_string())?
    );
    if matches!(response, HostMessage::Error { .. }) {
        Err("host rejected the command".to_owned())
    } else {
        Ok(())
    }
}

struct Parsed {
    socket: Option<PathBuf>,
    client_id: Option<String>,
    connect_only: bool,
    command: Command,
}

fn parse(arguments: Vec<OsString>) -> Result<Parsed, String> {
    let mut socket = None;
    let mut client_id = None;
    let mut connect_only = false;
    let mut command = None;
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.to_str() {
            Some("--socket") => {
                socket = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--socket requires a path".to_owned())?,
                ));
            }
            Some("--client-id") => {
                client_id = Some(
                    arguments
                        .next()
                        .ok_or_else(|| "--client-id requires an ID".to_owned())?
                        .into_string()
                        .map_err(|_| "client ID is not valid UTF-8".to_owned())?,
                );
            }
            Some("--connect-only") => connect_only = true,
            Some("snapshot") if command.is_none() => command = Some(Command::Snapshot),
            Some("ping") if command.is_none() => command = Some(Command::Ping),
            Some("shutdown") if command.is_none() => command = Some(Command::Shutdown),
            Some(other) => return Err(format!("unknown argument {other}\n{HELP}")),
            None => return Err("argument is not valid UTF-8".to_owned()),
        }
    }
    Ok(Parsed {
        socket,
        client_id,
        connect_only,
        command: command.ok_or_else(|| HELP.to_owned())?,
    })
}
