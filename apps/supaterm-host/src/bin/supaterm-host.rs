use std::env;
use std::ffi::OsString;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{ExitCode, Stdio};
use std::time::Duration;

use supaterm_host::protocol::{BUILD_VERSION, ClientRole, Hello};
use supaterm_host::transport::{
    ReferenceClient, RuntimePaths, ServerConfig, UnixServer, bridge_stdio, connect_or_start,
};

const HELP: &str = "Usage:\n  supaterm-host serve [--socket PATH] [--foreground]\n  supaterm-host stdio [--socket PATH]\n  supaterm-host version\n  supaterm-host --version";

struct DetachedHostChild(Option<std::process::Child>);

impl DetachedHostChild {
    fn spawn(command: &mut std::process::Command) -> Result<Self, std::io::Error> {
        command.spawn().map(|child| Self(Some(child)))
    }

    fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, std::io::Error> {
        self.0.as_mut().expect("child must exist").try_wait()
    }

    fn detach(mut self) {
        drop(self.0.take());
    }
}

impl Drop for DetachedHostChild {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("supaterm-host: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), String> {
    let mut arguments = env::args_os().skip(1);
    let Some(command) = arguments.next() else {
        return Err(HELP.to_owned());
    };
    match command.to_str() {
        Some("version" | "--version" | "-V") => {
            if arguments.next().is_some() {
                return Err("version takes no arguments".to_owned());
            }
            println!("supaterm-host {BUILD_VERSION}");
            Ok(())
        }
        Some("--help" | "-h" | "help") => {
            println!("{HELP}");
            Ok(())
        }
        Some("serve") => {
            let options = parse_options(arguments.collect(), true)?;
            let paths = resolve_paths(options.socket.clone())?;
            if options.foreground {
                run_server(paths).await
            } else {
                tokio::time::timeout(
                    Duration::from_secs(6),
                    start_detached(options.socket, paths),
                )
                .await
                .map_err(|_| "host start timed out".to_owned())?
            }
        }
        Some("stdio") => {
            let options = parse_options(arguments.collect(), false)?;
            let use_socket_override = options.socket.is_some();
            let paths = resolve_paths(options.socket)?;
            drop(
                connect_or_start(
                    &paths,
                    use_socket_override,
                    Hello::new(ClientRole::Ssh, format!("stdio-{}", std::process::id())),
                )
                .await
                .map_err(|error| error.to_string())?,
            );
            bridge_stdio(&paths.socket)
                .await
                .map_err(|error| error.to_string())
        }
        Some(other) => Err(format!("unknown command {other}\n{HELP}")),
        None => Err("command is not valid UTF-8".to_owned()),
    }
}

async fn run_server(paths: RuntimePaths) -> Result<(), String> {
    let server = UnixServer::bind(ServerConfig::new(paths)).map_err(|error| error.to_string())?;
    let shutdown = server.shutdown_handle();
    let signal_task = tokio::spawn(async move {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler must install");
        let mut interrupt =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
                .expect("SIGINT handler must install");
        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
        }
        shutdown.request();
    });
    let result = server.run().await.map_err(|error| error.to_string());
    signal_task.abort();
    result
}

async fn start_detached(
    socket_override: Option<PathBuf>,
    paths: RuntimePaths,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    let hello = Hello::new(ClientRole::Cli, format!("launcher-{}", std::process::id()));
    if connect_before(&paths, hello.clone(), deadline).await {
        return Ok(());
    }
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let mut command = std::process::Command::new(executable);
    command.arg("serve").arg("--foreground");
    if let Some(socket) = socket_override {
        command.arg("--socket").arg(socket);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut child = DetachedHostChild::spawn(&mut command).map_err(|error| error.to_string())?;
    let mut exit_status = None;
    loop {
        if exit_status.is_none() {
            exit_status = child.try_wait().map_err(|error| error.to_string())?;
        }
        if connect_before(&paths, hello.clone(), deadline).await {
            if exit_status.is_none() {
                exit_status = child.try_wait().map_err(|error| error.to_string())?;
            }
            if exit_status.is_none() {
                child.detach();
            }
            return Ok(());
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(20))).await;
    }
    let exit_status = match exit_status {
        Some(status) => Some(status),
        None => child.try_wait().map_err(|error| error.to_string())?,
    };
    match exit_status {
        Some(status) => Err(format!("detached host exited with {status}")),
        None => Err("detached host did not become ready".to_owned()),
    }
}

async fn connect_before(
    paths: &RuntimePaths,
    hello: Hello,
    deadline: tokio::time::Instant,
) -> bool {
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    !remaining.is_zero()
        && matches!(
            tokio::time::timeout(remaining, ReferenceClient::connect(&paths.socket, hello)).await,
            Ok(Ok(_))
        )
}

struct Options {
    socket: Option<PathBuf>,
    foreground: bool,
}

fn parse_options(arguments: Vec<OsString>, allow_foreground: bool) -> Result<Options, String> {
    let mut socket = None;
    let mut foreground = false;
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
            Some("--foreground") if allow_foreground => foreground = true,
            Some(other) => return Err(format!("unknown option {other}")),
            None => return Err("option is not valid UTF-8".to_owned()),
        }
    }
    Ok(Options { socket, foreground })
}

fn resolve_paths(socket: Option<PathBuf>) -> Result<RuntimePaths, String> {
    match socket {
        Some(socket) => RuntimePaths::for_socket(socket),
        None => RuntimePaths::resolve(),
    }
    .map_err(|error| error.to_string())
}
