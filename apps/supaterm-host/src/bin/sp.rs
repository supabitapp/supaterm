use std::collections::BTreeMap;
use std::env;
use std::ffi::OsString;
use std::io::{IsTerminal, Read};
use std::path::PathBuf;
use std::process::ExitCode;
use std::str::FromStr;

use serde::Serialize;
use sha2::{Digest, Sha256};
use supaterm_host::protocol::{
    BUILD_VERSION, CapturePaneRequest, CaptureScope, ClientRole, ClosePaneRequest, Command,
    CommandResult, Hello, HostMessage, ListItem, ListItemKind, ListRequest, NewTabRequest,
    PaneHealthRequest, PaneId, SendTextRequest,
};
use supaterm_host::random_identifier;
use supaterm_host::transport::{ReferenceClient, RuntimePaths, connect_or_start};

const HELP: &str = "Usage:\n  sp ls [--json | --plain] [--quiet]\n  sp tab new [--cwd PATH] [--json | --plain] [--quiet] [-- COMMAND...]\n  sp pane send [--newline] [--json | --plain] [--quiet] PANE_ID [TEXT | -]\n  sp pane capture [--scope visible|scrollback] [--lines N] [--json | --plain] [--quiet] PANE_ID\n  sp pane health [--json | --plain] [--quiet] PANE_ID\n  sp pane close [--json | --plain] [--quiet] PANE_ID\n  sp snapshot\n  sp ping\n  sp shutdown\n  sp version\n  sp --help";

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
    match parse(env::args_os().skip(1).collect())? {
        Parsed::Help => {
            println!("{HELP}");
            Ok(())
        }
        Parsed::Version => {
            println!("sp {BUILD_VERSION}");
            Ok(())
        }
        Parsed::Request(request) => execute(request).await,
    }
}

async fn execute(request: Request) -> Result<(), String> {
    let socket = request
        .connection
        .socket
        .or_else(|| env::var_os("SUPATERM_HOST_SOCKET_PATH").map(PathBuf::from));
    let use_socket_override = socket.is_some();
    let paths = match socket {
        Some(socket) => RuntimePaths::for_socket(socket),
        None => RuntimePaths::resolve(),
    }
    .map_err(|error| error.to_string())?;
    let client_id = request
        .connection
        .client_id
        .unwrap_or_else(|| format!("sp-{}", unsafe { libc::getuid() }));
    let hello = Hello::new(ClientRole::Cli, client_id);
    let mut client = if request.connection.connect_only {
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
            request.command,
        )
        .await
        .map_err(|error| error.to_string())?;
    if let HostMessage::Error { error, .. } = &response {
        return Err(error.detail.clone());
    }
    let output = render(&response, request.presentation)?;
    if let Some(output) = output {
        println!("{output}");
    }
    Ok(())
}

enum Parsed {
    Help,
    Version,
    Request(Request),
}

struct Request {
    connection: Connection,
    command: Command,
    presentation: Presentation,
}

#[derive(Default)]
struct Connection {
    socket: Option<PathBuf>,
    client_id: Option<String>,
    connect_only: bool,
}

#[derive(Clone, Copy)]
enum Presentation {
    Protocol,
    Public {
        result: PublicResult,
        output: OutputOptions,
    },
}

#[derive(Clone, Copy)]
enum PublicResult {
    List,
    TabCreated,
    TextSent,
    PaneCaptured,
    PaneHealth,
    PaneClosed,
}

#[derive(Clone, Copy, Default)]
struct OutputOptions {
    mode: OutputMode,
    quiet: bool,
}

#[derive(Clone, Copy, Default)]
enum OutputMode {
    #[default]
    Human,
    Json,
    Plain,
}

fn parse(arguments: Vec<OsString>) -> Result<Parsed, String> {
    let (connection, arguments) = extract_connection(arguments)?;
    let mut arguments = utf8_arguments(arguments)?;
    if matches!(arguments.as_slice(), [argument] if matches!(argument.as_str(), "--help" | "-h" | "help"))
    {
        return Ok(Parsed::Help);
    }
    if matches!(
        arguments.first().map(String::as_str),
        Some("version" | "--version" | "-V")
    ) {
        if arguments.len() != 1 {
            return Err("version takes no arguments".to_owned());
        }
        return Ok(Parsed::Version);
    }
    let output = extract_output(&mut arguments)?;
    let Some(command) = arguments.first().map(String::as_str) else {
        return Err(HELP.to_owned());
    };
    let (command, presentation) = match command {
        "ls" => parse_list(&arguments[1..], output)?,
        "tab" => parse_tab(&arguments[1..], output)?,
        "pane" => parse_pane(&arguments[1..], output)?,
        "snapshot" => parse_protocol(Command::Snapshot, &arguments[1..], output)?,
        "ping" => parse_protocol(Command::Ping, &arguments[1..], output)?,
        "shutdown" => parse_protocol(Command::Shutdown, &arguments[1..], output)?,
        other => return Err(format!("unknown command {other}\n{HELP}")),
    };
    Ok(Parsed::Request(Request {
        connection,
        command,
        presentation,
    }))
}

fn extract_connection(arguments: Vec<OsString>) -> Result<(Connection, Vec<OsString>), String> {
    let mut connection = Connection::default();
    let mut remaining = Vec::new();
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        if argument == "--" {
            remaining.push(argument);
            remaining.extend(arguments);
            break;
        }
        match argument.to_str() {
            Some("--socket") => {
                connection.socket = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--socket requires a path".to_owned())?,
                ));
            }
            Some("--client-id") => {
                connection.client_id = Some(
                    arguments
                        .next()
                        .ok_or_else(|| "--client-id requires an ID".to_owned())?
                        .into_string()
                        .map_err(|_| "client ID is not valid UTF-8".to_owned())?,
                );
            }
            Some("--connect-only") => connection.connect_only = true,
            _ => remaining.push(argument),
        }
    }
    Ok((connection, remaining))
}

fn utf8_arguments(arguments: Vec<OsString>) -> Result<Vec<String>, String> {
    arguments
        .into_iter()
        .map(|argument| {
            argument
                .into_string()
                .map_err(|_| "argument is not valid UTF-8".to_owned())
        })
        .collect()
}

fn extract_output(arguments: &mut Vec<String>) -> Result<OutputOptions, String> {
    let mut output = OutputOptions::default();
    let mut remaining = Vec::with_capacity(arguments.len());
    let mut iterator = std::mem::take(arguments).into_iter();
    while let Some(argument) = iterator.next() {
        if argument == "--" {
            remaining.push(argument);
            remaining.extend(iterator);
            break;
        }
        match argument.as_str() {
            "--json" => match output.mode {
                OutputMode::Plain => {
                    return Err("--json and --plain cannot be used together".to_owned());
                }
                OutputMode::Human | OutputMode::Json => output.mode = OutputMode::Json,
            },
            "--plain" => match output.mode {
                OutputMode::Json => {
                    return Err("--json and --plain cannot be used together".to_owned());
                }
                OutputMode::Human | OutputMode::Plain => output.mode = OutputMode::Plain,
            },
            "--quiet" | "-q" => output.quiet = true,
            "--no-color" => {}
            _ => remaining.push(argument),
        }
    }
    *arguments = remaining;
    Ok(output)
}

fn parse_protocol(
    command: Command,
    arguments: &[String],
    output: OutputOptions,
) -> Result<(Command, Presentation), String> {
    if !arguments.is_empty() {
        return Err("command takes no arguments".to_owned());
    }
    if !matches!(output.mode, OutputMode::Human) || output.quiet {
        return Err("output mode is unavailable for this command".to_owned());
    }
    Ok((command, Presentation::Protocol))
}

fn parse_list(
    arguments: &[String],
    output: OutputOptions,
) -> Result<(Command, Presentation), String> {
    if !arguments.is_empty() {
        return Err("ls takes no arguments".to_owned());
    }
    Ok((
        Command::List {
            request: ListRequest::default(),
        },
        public(PublicResult::List, output),
    ))
}

fn parse_tab(
    arguments: &[String],
    output: OutputOptions,
) -> Result<(Command, Presentation), String> {
    let Some((subcommand, arguments)) = arguments.split_first() else {
        return Err("tab requires a subcommand".to_owned());
    };
    if subcommand != "new" {
        return Err(format!("unknown tab command {subcommand}"));
    }
    let mut cwd = None;
    let mut argv = Vec::new();
    let mut arguments = arguments.iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--cwd" => {
                if cwd.is_some() {
                    return Err("--cwd may only be provided once".to_owned());
                }
                let value = arguments
                    .next()
                    .ok_or_else(|| "--cwd requires a path".to_owned())?;
                cwd = Some(resolve_working_directory(value)?);
            }
            "--" => {
                argv.extend(arguments.cloned());
                break;
            }
            other => return Err(format!("unknown tab new argument {other}")),
        }
    }
    if argv.first().is_some_and(String::is_empty) {
        return Err("trailing command must start with an executable".to_owned());
    }
    let mut environment = BTreeMap::new();
    if let Ok(path) = env::var("PATH") {
        environment.insert("PATH".to_owned(), path);
    }
    Ok((
        Command::NewTab {
            request: NewTabRequest {
                argv,
                cwd,
                environment,
            },
        },
        public(PublicResult::TabCreated, output),
    ))
}

fn parse_pane(
    arguments: &[String],
    output: OutputOptions,
) -> Result<(Command, Presentation), String> {
    let Some((subcommand, arguments)) = arguments.split_first() else {
        return Err("pane requires a subcommand".to_owned());
    };
    match subcommand.as_str() {
        "send" => parse_send(arguments, output),
        "capture" => parse_capture(arguments, output),
        "health" => parse_pane_id_command(arguments, output, PublicResult::PaneHealth, |pane_id| {
            Command::PaneHealth {
                request: PaneHealthRequest { pane_id },
            }
        }),
        "close" => parse_pane_id_command(arguments, output, PublicResult::PaneClosed, |pane_id| {
            Command::ClosePane {
                request: ClosePaneRequest { pane_id },
            }
        }),
        other => Err(format!("unknown pane command {other}")),
    }
}

fn parse_send(
    arguments: &[String],
    output: OutputOptions,
) -> Result<(Command, Presentation), String> {
    let mut newline = false;
    let mut positional = Vec::new();
    let mut literal = false;
    for argument in arguments {
        if literal {
            positional.push(argument.clone());
        } else {
            match argument.as_str() {
                "--newline" => newline = true,
                "--" => literal = true,
                other if other.starts_with('-') && other != "-" => {
                    return Err(format!("unknown pane send argument {other}"));
                }
                _ => positional.push(argument.clone()),
            }
        }
    }
    if positional.is_empty() || positional.len() > 2 {
        return Err("pane send requires a pane ID and at most one text argument".to_owned());
    }
    let pane_id = parse_pane_id(&positional[0])?;
    let mut text = match positional.get(1) {
        Some(argument) if argument != "-" => argument.clone(),
        Some(_) => read_standard_input()?,
        None if !std::io::stdin().is_terminal() => read_standard_input()?,
        None => return Err("provide text or pipe stdin".to_owned()),
    };
    if newline {
        text.push('\n');
    }
    Ok((
        Command::SendText {
            request: SendTextRequest { pane_id, text },
        },
        public(PublicResult::TextSent, output),
    ))
}

fn parse_capture(
    arguments: &[String],
    output: OutputOptions,
) -> Result<(Command, Presentation), String> {
    let mut scope = CaptureScope::Visible;
    let mut lines = None;
    let mut pane = None;
    let mut arguments = arguments.iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--scope" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| "--scope requires visible or scrollback".to_owned())?;
                scope = match value.as_str() {
                    "visible" => CaptureScope::Visible,
                    "scrollback" => CaptureScope::Scrollback,
                    _ => return Err("--scope requires visible or scrollback".to_owned()),
                };
            }
            "--lines" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| "--lines requires a count".to_owned())?;
                let count = value
                    .parse::<u32>()
                    .map_err(|_| "--lines must be 1 or greater".to_owned())?;
                if count == 0 {
                    return Err("--lines must be 1 or greater".to_owned());
                }
                lines = Some(count);
            }
            "--" => {
                let value = arguments
                    .next()
                    .ok_or_else(|| "pane capture requires a pane ID".to_owned())?;
                if pane.replace(parse_pane_id(value)?).is_some() || arguments.next().is_some() {
                    return Err("pane capture accepts one pane ID".to_owned());
                }
                break;
            }
            other if other.starts_with('-') => {
                return Err(format!("unknown pane capture argument {other}"));
            }
            value => {
                if pane.replace(parse_pane_id(value)?).is_some() {
                    return Err("pane capture accepts one pane ID".to_owned());
                }
            }
        }
    }
    let pane_id = pane.ok_or_else(|| "pane capture requires a pane ID".to_owned())?;
    Ok((
        Command::CapturePane {
            request: CapturePaneRequest {
                pane_id,
                scope,
                lines,
            },
        },
        public(PublicResult::PaneCaptured, output),
    ))
}

fn parse_pane_id_command(
    arguments: &[String],
    output: OutputOptions,
    result: PublicResult,
    command: impl FnOnce(PaneId) -> Command,
) -> Result<(Command, Presentation), String> {
    let arguments = match arguments {
        [delimiter, rest @ ..] if delimiter == "--" => rest,
        _ => arguments,
    };
    let [pane_id] = arguments else {
        return Err("pane command requires one pane ID".to_owned());
    };
    Ok((command(parse_pane_id(pane_id)?), public(result, output)))
}

fn parse_pane_id(value: &str) -> Result<PaneId, String> {
    PaneId::from_str(value).map_err(|_| format!("invalid pane ID {value}"))
}

fn resolve_working_directory(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("--cwd must not be empty".to_owned());
    }
    let path = if value == "~" {
        home_directory()?
    } else if let Some(relative) = value.strip_prefix("~/") {
        home_directory()?.join(relative)
    } else {
        PathBuf::from(value)
    };
    if path.is_absolute() {
        Ok(path)
    } else {
        env::current_dir()
            .map(|directory| directory.join(path))
            .map_err(|error| error.to_string())
    }
}

fn home_directory() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is unavailable".to_owned())
}

fn read_standard_input() -> Result<String, String> {
    let mut text = String::new();
    std::io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    Ok(text)
}

fn public(result: PublicResult, output: OutputOptions) -> Presentation {
    Presentation::Public { result, output }
}

fn render(response: &HostMessage, presentation: Presentation) -> Result<Option<String>, String> {
    match presentation {
        Presentation::Protocol => serde_json::to_string(response)
            .map(Some)
            .map_err(|error| error.to_string()),
        Presentation::Public { result, output } if output.quiet => {
            validate_result(response, result)?;
            Ok(None)
        }
        Presentation::Public { result, output } => {
            render_public(response, result, output.mode).map(Some)
        }
    }
}

fn validate_result(response: &HostMessage, expected: PublicResult) -> Result<(), String> {
    let result = command_result(response)?;
    let matches = matches!(
        (expected, result),
        (PublicResult::List, CommandResult::Listed { .. })
            | (PublicResult::TabCreated, CommandResult::TabCreated { .. })
            | (PublicResult::TextSent, CommandResult::TextSent { .. })
            | (
                PublicResult::PaneCaptured,
                CommandResult::PaneCaptured { .. }
            )
            | (PublicResult::PaneHealth, CommandResult::PaneHealth { .. })
            | (PublicResult::PaneClosed, CommandResult::PaneClosed { .. })
    );
    if matches {
        Ok(())
    } else {
        Err("host returned an unexpected result".to_owned())
    }
}

fn render_public(
    response: &HostMessage,
    expected: PublicResult,
    mode: OutputMode,
) -> Result<String, String> {
    let result = command_result(response)?;
    match (expected, result) {
        (PublicResult::List, CommandResult::Listed { items, .. }) => render_list(items, mode),
        (PublicResult::TabCreated, CommandResult::TabCreated { pane_id })
        | (PublicResult::TextSent, CommandResult::TextSent { pane_id })
        | (PublicResult::PaneClosed, CommandResult::PaneClosed { pane_id }) => {
            render_identity(*pane_id, mode)
        }
        (PublicResult::PaneCaptured, CommandResult::PaneCaptured { pane_id, text }) => {
            render_capture(*pane_id, text, mode)
        }
        (
            PublicResult::PaneHealth,
            CommandResult::PaneHealth {
                pane_id,
                is_ready,
                can_capture_text,
            },
        ) => render_health(*pane_id, *is_ready, *can_capture_text, mode),
        _ => Err("host returned an unexpected result".to_owned()),
    }
}

fn command_result(response: &HostMessage) -> Result<&CommandResult, String> {
    match response {
        HostMessage::Result { result, .. } => Ok(result),
        HostMessage::Error { error, .. } => Err(error.detail.clone()),
        HostMessage::Welcome(_) => Err("host returned an unexpected response".to_owned()),
    }
}

#[derive(Serialize)]
struct PaneIdentity {
    #[serde(rename = "paneID")]
    pane_id: PaneId,
}

#[derive(Serialize)]
struct CaptureOutput<'a> {
    target: PaneIdentity,
    text: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthOutput {
    target: PaneIdentity,
    is_ready: bool,
    can_capture_text: bool,
}

#[derive(Serialize)]
struct ListOutput<'a> {
    revision: String,
    items: &'a [ListOutputItem],
}

#[derive(Serialize)]
struct ListPayload<'a> {
    items: &'a [ListOutputItem],
}

#[derive(Serialize)]
struct ListOutputItem {
    kind: ListItemKind,
    id: PaneId,
}

fn render_identity(pane_id: PaneId, mode: OutputMode) -> Result<String, String> {
    match mode {
        OutputMode::Json => json(&PaneIdentity { pane_id }),
        OutputMode::Human | OutputMode::Plain => Ok(pane_id.to_string()),
    }
}

fn render_capture(pane_id: PaneId, text: &str, mode: OutputMode) -> Result<String, String> {
    match mode {
        OutputMode::Json => json(&CaptureOutput {
            target: PaneIdentity { pane_id },
            text,
        }),
        OutputMode::Human | OutputMode::Plain => Ok(text.to_owned()),
    }
}

fn render_health(
    pane_id: PaneId,
    is_ready: bool,
    can_capture_text: bool,
    mode: OutputMode,
) -> Result<String, String> {
    match mode {
        OutputMode::Json => json(&HealthOutput {
            target: PaneIdentity { pane_id },
            is_ready,
            can_capture_text,
        }),
        OutputMode::Human | OutputMode::Plain => {
            Ok(format!("ready={is_ready} capture={can_capture_text}"))
        }
    }
}

fn render_list(items: &[ListItem], mode: OutputMode) -> Result<String, String> {
    let items = items
        .iter()
        .map(|item| ListOutputItem {
            kind: item.kind,
            id: item.id,
        })
        .collect::<Vec<_>>();
    match mode {
        OutputMode::Json => list_json(&items),
        OutputMode::Human => Ok(items
            .iter()
            .map(|item| format!("{} {}", list_kind(item.kind), item.id))
            .collect::<Vec<_>>()
            .join("\n")),
        OutputMode::Plain => Ok(items
            .iter()
            .map(|item| item.id.to_string())
            .collect::<Vec<_>>()
            .join("\n")),
    }
}

fn list_kind(kind: ListItemKind) -> &'static str {
    match kind {
        ListItemKind::Pane => "pane",
    }
}

fn list_json(items: &[ListOutputItem]) -> Result<String, String> {
    let digest = Sha256::digest(
        serde_json::to_vec(&ListPayload { items }).map_err(|error| error.to_string())?,
    );
    let revision = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    json(&ListOutput { revision, items })
}

fn json(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}
