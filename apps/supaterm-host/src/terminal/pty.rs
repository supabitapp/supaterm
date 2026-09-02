use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use thiserror::Error;
use tokio::io::unix::AsyncFd;

const PROTECTED_ENVIRONMENT_KEYS: &[&str] = &[
    "SUPATERM_HOST_SOCKET_PATH",
    "SUPATERM_CLI_PATH",
    "SUPATERM_PANE_ID",
    "SUPATERM_STATE_HOME",
];

const REMOVED_ENVIRONMENT_KEYS: &[&str] = &[
    "SUPATERM_SOCKET_PATH",
    "SUPATERM_SURFACE_ID",
    "SUPATERM_TAB_ID",
    "ZMX_DIR",
    "ZMX_SESSION",
    "ZMX_SESSION_PREFIX",
    "TMUX",
    "TMUX_PANE",
    "STY",
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SpawnSpec {
    pub argv: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub environment: Vec<(String, String)>,
    pub rows: u16,
    pub columns: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalEnvironment {
    pub socket_path: PathBuf,
    pub cli_path: PathBuf,
    pub state_home: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum SpawnError {
    #[error("working directory not found: {0}")]
    WorkingDirectoryNotFound(PathBuf),
    #[error("executable not found: {0}")]
    ExecutableNotFound(String),
    #[error("environment key is host-owned: {0}")]
    ProtectedEnvironment(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

pub struct Pty {
    master: AsyncFd<OwnedFd>,
    pid: u32,
}

pub(crate) struct PtyWriter {
    master: AsyncFd<OwnedFd>,
}

impl Pty {
    pub fn spawn(spec: &SpawnSpec) -> Result<(Self, Child), SpawnError> {
        Self::spawn_with_environment(spec, None, None)
    }

    pub(crate) fn spawn_with_environment(
        spec: &SpawnSpec,
        pane_id: Option<crate::protocol::terminal::PaneId>,
        terminal_environment: Option<&TerminalEnvironment>,
    ) -> Result<(Self, Child), SpawnError> {
        if let Some(cwd) = &spec.cwd
            && !cwd.is_dir()
        {
            return Err(SpawnError::WorkingDirectoryNotFound(cwd.clone()));
        }
        if let Some((key, _)) = spec
            .environment
            .iter()
            .find(|(key, _)| PROTECTED_ENVIRONMENT_KEYS.contains(&key.as_str()))
        {
            return Err(SpawnError::ProtectedEnvironment(key.clone()));
        }
        let mut master_raw = -1;
        let mut slave_raw = -1;
        let window = libc::winsize {
            ws_row: spec.rows,
            ws_col: spec.columns,
            ws_xpixel: spec.pixel_width,
            ws_ypixel: spec.pixel_height,
        };
        let result = unsafe {
            libc::openpty(
                &mut master_raw,
                &mut slave_raw,
                std::ptr::null_mut(),
                std::ptr::null_mut::<libc::termios>() as _,
                (&raw const window).cast_mut() as _,
            )
        };
        if result != 0 {
            return Err(SpawnError::Io(io::Error::last_os_error()));
        }
        let master = unsafe { OwnedFd::from_raw_fd(master_raw) };
        let slave = SlaveFd(slave_raw);
        set_cloexec(master.as_raw_fd())?;
        set_nonblocking(master.as_raw_fd())?;
        let (program, arguments, login_shell) = resolve_program(&spec.argv);
        if program.contains('/') && !Path::new(&program).is_file() {
            return Err(SpawnError::ExecutableNotFound(program));
        }
        let mut command = Command::new(&program);
        command.args(arguments);
        if login_shell {
            let name = Path::new(&program)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("sh");
            command.arg0(format!("-{name}"));
        }
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        for key in inherited_terminal_environment() {
            command.env_remove(key);
        }
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        for (key, value) in &spec.environment {
            command.env(key, value);
        }
        if let (Some(pane_id), Some(environment)) = (pane_id, terminal_environment) {
            command.env("SUPATERM_HOST_SOCKET_PATH", &environment.socket_path);
            command.env("SUPATERM_CLI_PATH", &environment.cli_path);
            command.env("SUPATERM_PANE_ID", pane_id.to_string());
            if let Some(state_home) = &environment.state_home {
                command.env("SUPATERM_STATE_HOME", state_home);
            }
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let raw_slave = slave.0;
        unsafe {
            command.pre_exec(move || prepare_child(raw_slave));
        }
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(SpawnError::ExecutableNotFound(program));
            }
            Err(error) => return Err(SpawnError::Io(error)),
        };
        let pid = child.id();
        drop(slave);
        Ok((
            Self {
                master: AsyncFd::new(master)?,
                pid,
            },
            child,
        ))
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn foreground_process_group(&self) -> io::Result<Option<u32>> {
        let process_group = unsafe { libc::tcgetpgrp(self.master.get_ref().as_raw_fd()) };
        if process_group > 0 {
            Ok(u32::try_from(process_group).ok())
        } else {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ENOTTY) {
                Ok(None)
            } else {
                Err(error)
            }
        }
    }

    pub(crate) fn writer(&self) -> io::Result<PtyWriter> {
        let fd =
            unsafe { libc::fcntl(self.master.get_ref().as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let master = unsafe { OwnedFd::from_raw_fd(fd) };
        set_nonblocking(master.as_raw_fd())?;
        Ok(PtyWriter {
            master: AsyncFd::new(master)?,
        })
    }

    pub fn resize(
        &self,
        rows: u16,
        columns: u16,
        pixel_width: u16,
        pixel_height: u16,
    ) -> io::Result<()> {
        let window = libc::winsize {
            ws_row: rows,
            ws_col: columns,
            ws_xpixel: pixel_width,
            ws_ypixel: pixel_height,
        };
        let result =
            unsafe { libc::ioctl(self.master.get_ref().as_raw_fd(), libc::TIOCSWINSZ, &window) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub async fn read(&self, buffer: &mut [u8]) -> io::Result<usize> {
        loop {
            let mut readiness = self.master.readable().await?;
            match readiness.try_io(|inner| {
                let count = unsafe {
                    libc::read(
                        inner.get_ref().as_raw_fd(),
                        buffer.as_mut_ptr().cast(),
                        buffer.len(),
                    )
                };
                if count < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(count as usize)
                }
            }) {
                Ok(result) => return result,
                Err(_) => continue,
            }
        }
    }

    pub async fn write_all(&self, mut data: &[u8]) -> io::Result<()> {
        while !data.is_empty() {
            let mut readiness = self.master.writable().await?;
            match readiness.try_io(|inner| {
                let count = unsafe {
                    libc::write(
                        inner.get_ref().as_raw_fd(),
                        data.as_ptr().cast(),
                        data.len(),
                    )
                };
                if count < 0 {
                    Err(io::Error::last_os_error())
                } else if count == 0 {
                    Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "PTY write returned zero",
                    ))
                } else {
                    Ok(count as usize)
                }
            }) {
                Ok(Ok(count)) => data = &data[count..],
                Ok(Err(error)) => return Err(error),
                Err(_) => continue,
            }
        }
        Ok(())
    }

    pub fn terminate_process_group(&self) -> io::Result<()> {
        signal_process_group(self.pid, libc::SIGTERM)
    }
}

impl PtyWriter {
    pub async fn write_all(&self, mut data: &[u8]) -> io::Result<()> {
        while !data.is_empty() {
            let mut readiness = self.master.writable().await?;
            match readiness.try_io(|inner| {
                let count = unsafe {
                    libc::write(
                        inner.get_ref().as_raw_fd(),
                        data.as_ptr().cast(),
                        data.len(),
                    )
                };
                if count < 0 {
                    Err(io::Error::last_os_error())
                } else if count == 0 {
                    Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "PTY write returned zero",
                    ))
                } else {
                    Ok(count as usize)
                }
            }) {
                Ok(Ok(count)) => data = &data[count..],
                Ok(Err(error)) => return Err(error),
                Err(_) => continue,
            }
        }
        Ok(())
    }
}

pub(crate) fn signal_process_group(pid: u32, signal: i32) -> io::Result<()> {
    let result = unsafe { libc::kill(-(pid as i32), signal) };
    if result == 0 {
        Ok(())
    } else {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(())
        } else {
            Err(error)
        }
    }
}

struct SlaveFd(RawFd);

impl Drop for SlaveFd {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.0);
        }
    }
}

fn set_cloexec(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn resolve_program(argv: &[String]) -> (String, &[String], bool) {
    if let Some((program, arguments)) = argv.split_first() {
        (program.clone(), arguments, false)
    } else {
        (
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
            &[],
            true,
        )
    }
}

fn inherited_terminal_environment() -> Vec<OsString> {
    std::env::vars_os()
        .map(|(key, _)| key)
        .filter(|key| {
            key.to_str().is_some_and(|key| {
                REMOVED_ENVIRONMENT_KEYS.contains(&key)
                    || PROTECTED_ENVIRONMENT_KEYS.contains(&key)
                    || key.starts_with("GHOSTTY_")
                    || key.starts_with("TERM_PROGRAM")
                    || key.starts_with("CLAUDE_CODE_")
            })
        })
        .collect()
}

fn prepare_child(slave: RawFd) -> io::Result<()> {
    unsafe {
        if libc::setsid() < 0 || libc::ioctl(slave, libc::TIOCSCTTY as _, 0) < 0 {
            return Err(io::Error::last_os_error());
        }
        for target in 0..=2 {
            if slave != target && libc::dup2(slave, target) < 0 {
                return Err(io::Error::last_os_error());
            }
        }
        if slave > 2 {
            libc::close(slave);
        }
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = libc::SIG_DFL;
        if libc::sigemptyset(&mut action.sa_mask) != 0 {
            return Err(io::Error::last_os_error());
        }
        for signal in [
            libc::SIGCHLD,
            libc::SIGHUP,
            libc::SIGINT,
            libc::SIGPIPE,
            libc::SIGQUIT,
            libc::SIGTERM,
            libc::SIGALRM,
            libc::SIGTSTP,
            libc::SIGTTIN,
            libc::SIGTTOU,
        ] {
            if libc::sigaction(signal, &action, std::ptr::null_mut()) != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        let mut signals: libc::sigset_t = std::mem::zeroed();
        if libc::sigemptyset(&mut signals) != 0
            || libc::sigprocmask(libc::SIG_SETMASK, &signals, std::ptr::null_mut()) != 0
        {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}
