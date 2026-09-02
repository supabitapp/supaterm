use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

use serde::Serialize;
use sha2::{Digest, Sha256};
use supaterm_host::protocol::{
    BUILD_VERSION, ClientRole, Command, CommandResult, Hello, HostMessage,
};
use supaterm_host::random_identifier;
use supaterm_host::transport::{ReferenceClient, RuntimePaths, connect_or_start};

const HELP: &str = "Usage:\n  sp [--connect-only] [--socket PATH] [--client-id ID] ls [--json | --plain | --quiet]\n  sp [--connect-only] [--socket PATH] [--client-id ID] snapshot\n  sp [--connect-only] [--socket PATH] [--client-id ID] ping\n  sp [--connect-only] [--socket PATH] [--client-id ID] shutdown\n  sp version\n  sp --help";

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
    let output = match parsed.output {
        Output::Protocol => Some(serde_json::to_string(&response)),
        Output::List => Some(Ok(String::new())),
        Output::ListJson => Some(list_json(&response)),
        Output::ListQuiet => None,
    };
    if let Some(output) = output {
        println!("{}", output.map_err(|error| error.to_string())?);
    }
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
    output: Output,
}

#[derive(Clone, Copy)]
enum Output {
    Protocol,
    List,
    ListJson,
    ListQuiet,
}

fn parse(arguments: Vec<OsString>) -> Result<Parsed, String> {
    let mut socket = None;
    let mut client_id = None;
    let mut connect_only = false;
    let mut command = None;
    let mut list = false;
    let mut list_output = None;
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
            Some("--json") if list_output.is_none() => list_output = Some(Output::ListJson),
            Some("--plain") if list_output.is_none() => list_output = Some(Output::List),
            Some("--quiet") if list_output.is_none() => list_output = Some(Output::ListQuiet),
            Some("--json" | "--plain" | "--quiet") => {
                return Err(format!("ls output modes are mutually exclusive\n{HELP}"));
            }
            Some("ls") if command.is_none() => {
                command = Some(Command::Snapshot);
                list = true;
            }
            Some("snapshot") if command.is_none() => command = Some(Command::Snapshot),
            Some("ping") if command.is_none() => command = Some(Command::Ping),
            Some("shutdown") if command.is_none() => command = Some(Command::Shutdown),
            Some(other) => return Err(format!("unknown argument {other}\n{HELP}")),
            None => return Err("argument is not valid UTF-8".to_owned()),
        }
    }
    let output = match (list, list_output) {
        (true, output) => output.unwrap_or(Output::List),
        (false, Some(_)) => return Err(format!("output mode requires ls\n{HELP}")),
        (false, None) => Output::Protocol,
    };
    Ok(Parsed {
        socket,
        client_id,
        connect_only,
        command: command.ok_or_else(|| HELP.to_owned())?,
        output,
    })
}

#[derive(Serialize)]
struct ListPayload<'a> {
    items: &'a [serde_json::Value],
}

#[derive(Serialize)]
struct ListOutput<'a> {
    revision: String,
    items: &'a [serde_json::Value],
}

fn list_json(response: &HostMessage) -> Result<String, serde_json::Error> {
    let HostMessage::Result {
        result: CommandResult::Snapshot { .. },
        ..
    } = response
    else {
        return serde_json::to_string(response);
    };
    let items = &[];
    let digest = Sha256::digest(serde_json::to_vec(&ListPayload { items })?);
    let revision = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    serde_json::to_string(&ListOutput { revision, items })
}
