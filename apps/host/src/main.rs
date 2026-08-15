use std::{collections::BTreeMap, io, os::fd::RawFd, path::PathBuf, process::ExitCode};

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand};
use supaterm_host::{
    ClientRole, CommandSpec, EnvironmentSpec, ErrorCode, HostClient, HostConfig, HostMessage,
    HostServer, ProcessExit, TerminalData, TerminalId, TerminalSize,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Parser)]
#[command(name = "supaterm-host", disable_version_flag = true)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve(Roots),
    Attach(AttachArgs),
}

#[derive(Clone, Args)]
struct Roots {
    #[arg(long)]
    runtime_root: PathBuf,
    #[arg(long)]
    state_root: PathBuf,
}

#[derive(Args)]
struct AttachArgs {
    #[command(flatten)]
    roots: Roots,
    #[arg(long)]
    terminal: Option<TerminalId>,
    #[arg(long)]
    cwd: Option<PathBuf>,
    #[arg(long = "env", value_parser = parse_environment)]
    environment: Vec<(String, String)>,
    #[arg(long)]
    clear_environment: bool,
    #[arg(long)]
    rows: Option<u16>,
    #[arg(long)]
    cols: Option<u16>,
    #[arg(long)]
    pixel_width: Option<u16>,
    #[arg(long)]
    pixel_height: Option<u16>,
    #[arg(last = true, allow_hyphen_values = true)]
    argv: Vec<String>,
}

#[tokio::main]
async fn main() -> ExitCode {
    if std::env::args_os().len() == 2
        && std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--version"))
    {
        println!(
            "supaterm-host {}",
            option_env!("SUPATERM_BUILD_VERSION").unwrap_or("dev")
        );
        return ExitCode::SUCCESS;
    }
    match run(Cli::parse()).await {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<u8> {
    match cli.command {
        Command::Serve(roots) => {
            let server =
                HostServer::bind(HostConfig::new(roots.runtime_root, roots.state_root)).await?;
            server.run().await?;
            Ok(0)
        }
        Command::Attach(arguments) => run_attach(arguments).await,
    }
}

async fn run_attach(arguments: AttachArgs) -> Result<u8> {
    let terminal_id = arguments.terminal.unwrap_or_default();
    let socket = arguments.roots.runtime_root.join("host.sock");
    let client = HostClient::connect(&socket, ClientRole::Attach)
        .await
        .with_context(|| format!("connect to {}", socket.display()))?;
    let size = requested_size(&arguments);

    match client.get(terminal_id).await {
        Ok(_) => {}
        Err(error) if error.remote_code() == Some(ErrorCode::NotFound) => {
            if arguments.argv.is_empty() {
                bail!("terminal does not exist and no fallback command was supplied");
            }
            let cwd = match arguments.cwd {
                Some(cwd) => cwd,
                None => std::env::current_dir().context("resolve current directory")?,
            };
            client
                .create(
                    terminal_id,
                    CommandSpec {
                        argv: arguments.argv,
                        cwd,
                        environment: command_environment(
                            arguments.clear_environment,
                            arguments.environment,
                        )?,
                    },
                    size,
                )
                .await?;
        }
        Err(error) => return Err(error.into()),
    }

    let attachment = client.attach(terminal_id).await?;
    client
        .resize(terminal_id, attachment.attachment_id, size)
        .await?;
    relay_terminal(client, terminal_id, attachment.attachment_id).await
}

async fn relay_terminal(
    mut client: HostClient,
    terminal_id: TerminalId,
    attachment_id: supaterm_host::AttachmentId,
) -> Result<u8> {
    let _raw_mode = RawMode::enable(libc::STDIN_FILENO)?;
    let requests = client.request_handle();
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut input = vec![0_u8; 32 * 1024];
    let mut stdin_open = true;
    let mut window_changes =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::window_change())?;

    loop {
        tokio::select! {
            read = stdin.read(&mut input), if stdin_open => {
                let length = read?;
                if length == 0 {
                    stdin_open = false;
                } else {
                    requests.input(
                        terminal_id,
                        attachment_id,
                        TerminalData::from(&input[..length]),
                    ).await?;
                }
            }
            event = client.next_event() => {
                match event? {
                    HostMessage::Output { data, .. } => {
                        stdout.write_all(data.as_bytes()).await?;
                        stdout.flush().await?;
                    }
                    HostMessage::Exited { exit, .. } => {
                        stdout.flush().await?;
                        return Ok(match exit {
                            ProcessExit::Code(code) => u8::try_from(code).unwrap_or(1),
                            ProcessExit::Signal(_) => 1,
                        });
                    }
                    message => bail!("unexpected host event: {message:?}"),
                }
            }
            _ = window_changes.recv() => {
                requests.resize(terminal_id, attachment_id, terminal_size(libc::STDIN_FILENO)).await?;
            }
        }
    }
}

fn command_environment(clear: bool, overrides: Vec<(String, String)>) -> Result<EnvironmentSpec> {
    let mut set = BTreeMap::new();
    if !clear {
        for (key, value) in std::env::vars_os() {
            let key = key
                .into_string()
                .map_err(|_| anyhow::anyhow!("environment key is not valid UTF-8"))?;
            let value = value
                .into_string()
                .map_err(|_| anyhow::anyhow!("environment value for {key} is not valid UTF-8"))?;
            set.insert(key, value);
        }
    }
    for (key, value) in overrides {
        set.insert(key, value);
    }
    Ok(EnvironmentSpec {
        inherit: false,
        set,
        remove: Vec::new(),
    })
}

fn requested_size(arguments: &AttachArgs) -> TerminalSize {
    let detected = terminal_size(libc::STDIN_FILENO);
    TerminalSize {
        rows: arguments.rows.unwrap_or(detected.rows),
        cols: arguments.cols.unwrap_or(detected.cols),
        pixel_width: arguments.pixel_width.unwrap_or(detected.pixel_width),
        pixel_height: arguments.pixel_height.unwrap_or(detected.pixel_height),
    }
}

fn terminal_size(fd: RawFd) -> TerminalSize {
    let mut value = std::mem::MaybeUninit::<libc::winsize>::zeroed();
    if unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, value.as_mut_ptr()) } == 0 {
        let value = unsafe { value.assume_init() };
        if value.ws_row > 0 && value.ws_col > 0 {
            return TerminalSize {
                rows: value.ws_row,
                cols: value.ws_col,
                pixel_width: value.ws_xpixel,
                pixel_height: value.ws_ypixel,
            };
        }
    }
    TerminalSize::default()
}

struct RawMode {
    fd: RawFd,
    original: Option<libc::termios>,
}

impl RawMode {
    fn enable(fd: RawFd) -> io::Result<Self> {
        if unsafe { libc::isatty(fd) } != 1 {
            return Ok(Self { fd, original: None });
        }
        let mut original = std::mem::MaybeUninit::<libc::termios>::uninit();
        if unsafe { libc::tcgetattr(fd, original.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let original = unsafe { original.assume_init() };
        let mut raw = original;
        unsafe {
            libc::cfmakeraw(&mut raw);
        }
        if unsafe { libc::tcsetattr(fd, libc::TCSANOW, &raw) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            fd,
            original: Some(original),
        })
    }
}

impl Drop for RawMode {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            unsafe {
                libc::tcsetattr(self.fd, libc::TCSANOW, original);
            }
        }
    }
}

fn parse_environment(value: &str) -> Result<(String, String), String> {
    let Some((key, value)) = value.split_once('=') else {
        return Err("environment must use KEY=VALUE".into());
    };
    if key.is_empty() || key.contains('\0') || value.contains('\0') {
        return Err("environment contains an invalid key or value".into());
    }
    Ok((key.into(), value.into()))
}
