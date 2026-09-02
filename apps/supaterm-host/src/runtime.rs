use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

const MAXIMUM_SOCKET_PATH_BYTES: usize = 103;

#[derive(Clone, Debug)]
pub struct PathConfiguration {
    pub state_home: Option<PathBuf>,
    pub home_directory: PathBuf,
    pub xdg_runtime_directory: Option<PathBuf>,
    pub temporary_directory: PathBuf,
    pub uid: u32,
}

impl PathConfiguration {
    pub fn from_environment() -> Result<Self, RuntimeError> {
        let home_directory = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or(RuntimeError::MissingHomeDirectory)?;
        Ok(Self {
            state_home: std::env::var_os("SUPATERM_STATE_HOME").map(PathBuf::from),
            home_directory,
            xdg_runtime_directory: std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from),
            temporary_directory: std::env::var_os("TMPDIR")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir),
            uid: unsafe { libc::geteuid() },
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePaths {
    pub home_directory: PathBuf,
    pub state_root: PathBuf,
    pub durable_state: PathBuf,
    pub runtime_directory: PathBuf,
    pub socket: PathBuf,
    pub serve_lock: PathBuf,
    pub process_record: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SocketState {
    Available,
    Live,
    RemovedStale,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("HOME is not set")]
    MissingHomeDirectory,
    #[error("another host holds the serve lock")]
    AlreadyServing,
    #[error("unsafe runtime path: {0}")]
    UnsafeRuntimePath(PathBuf),
    #[error("unsafe socket path: {0}")]
    UnsafeSocketPath(PathBuf),
    #[error("cannot probe socket {path}: {source}")]
    CannotProbeSocket { path: PathBuf, source: io::Error },
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl RuntimePaths {
    pub fn initialize(configuration: PathConfiguration) -> Result<Self, RuntimeError> {
        let state_root = configuration
            .state_home
            .unwrap_or_else(|| configuration.home_directory.join(".config/supaterm"));
        ensure_private_directory(&state_root, configuration.uid)?;
        let state_root = state_root.canonicalize()?;
        let hash = state_root_hash(&state_root);
        let directory_name = format!("st-{}-{hash}", configuration.uid);
        let bases = configuration
            .xdg_runtime_directory
            .into_iter()
            .chain(std::iter::once(configuration.temporary_directory));
        let runtime_directory = bases
            .map(|base| base.join(&directory_name))
            .find(|directory| {
                directory
                    .join("host.sock")
                    .as_os_str()
                    .as_encoded_bytes()
                    .len()
                    <= MAXIMUM_SOCKET_PATH_BYTES
            })
            .ok_or_else(|| RuntimeError::UnsafeRuntimePath(state_root.clone()))?;
        ensure_private_directory(&runtime_directory, configuration.uid)?;
        Ok(Self {
            home_directory: configuration.home_directory,
            durable_state: state_root.join("host-state.json"),
            state_root,
            socket: runtime_directory.join("host.sock"),
            serve_lock: runtime_directory.join("serve.lock"),
            process_record: runtime_directory.join("host.json"),
            runtime_directory,
        })
    }

    pub fn acquire_serve_lock(&self) -> Result<ServeLock, RuntimeError> {
        if let Ok(metadata) = fs::symlink_metadata(&self.serve_lock)
            && (!metadata.file_type().is_file() || metadata.uid() != unsafe { libc::geteuid() })
        {
            return Err(RuntimeError::UnsafeRuntimePath(self.serve_lock.clone()));
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&self.serve_lock)?;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result != 0 {
            let error = io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN)
            {
                return Err(RuntimeError::AlreadyServing);
            }
            return Err(RuntimeError::Io(error));
        }
        Ok(ServeLock { file })
    }

    pub fn prepare_socket(&self) -> Result<SocketState, RuntimeError> {
        let metadata = match fs::symlink_metadata(&self.socket) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(SocketState::Available);
            }
            Err(error) => return Err(RuntimeError::Io(error)),
        };
        if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
            return Err(RuntimeError::UnsafeSocketPath(self.socket.clone()));
        }
        match UnixStream::connect(&self.socket) {
            Ok(_) => Ok(SocketState::Live),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound
                ) =>
            {
                if self.socket.exists() {
                    fs::remove_file(&self.socket)?;
                    Ok(SocketState::RemovedStale)
                } else {
                    Ok(SocketState::Available)
                }
            }
            Err(source) => Err(RuntimeError::CannotProbeSocket {
                path: self.socket.clone(),
                source,
            }),
        }
    }
}

pub struct ServeLock {
    file: File,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProcessRecord {
    pub pid: u32,
    pub uid: u32,
    pub start_identity: String,
    pub executable: PathBuf,
    pub protocol_version: u16,
    pub build: crate::protocol::control::BuildIdentity,
}

impl ProcessRecord {
    pub fn current(build: crate::protocol::control::BuildIdentity) -> Result<Self, RuntimeError> {
        let pid = std::process::id();
        Ok(Self {
            pid,
            uid: unsafe { libc::geteuid() },
            start_identity: process_start_identity(pid)?,
            executable: std::env::current_exe()?.canonicalize()?,
            protocol_version: crate::protocol::control::PROTOCOL_VERSION,
            build,
        })
    }

    pub fn write(&self, path: &Path) -> Result<(), RuntimeError> {
        let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(self).map_err(io::Error::other)?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)?;
        use std::io::Write;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(())
    }

    pub fn still_matches(&self) -> bool {
        self.uid == unsafe { libc::geteuid() }
            && matches!(process_start_identity(self.pid), Ok(value) if value == self.start_identity)
            && matches!(process_executable(self.pid), Ok(value) if value == self.executable)
    }
}

impl Drop for ServeLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

fn ensure_private_directory(path: &Path, uid: u32) -> Result<(), RuntimeError> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.uid() != uid {
        return Err(RuntimeError::UnsafeRuntimePath(path.to_path_buf()));
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn state_root_hash(path: &Path) -> String {
    let digest = Sha256::digest(path.as_os_str().as_encoded_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(target_os = "linux")]
fn process_start_identity(pid: u32) -> Result<String, RuntimeError> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let suffix = stat
        .rsplit_once(") ")
        .map(|(_, suffix)| suffix)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid process stat"))?;
    suffix
        .split_whitespace()
        .nth(19)
        .map(str::to_owned)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing process start"))
        .map_err(RuntimeError::Io)
}

#[cfg(target_os = "macos")]
fn process_start_identity(pid: u32) -> Result<String, RuntimeError> {
    let output = Command::new("/bin/ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .output()?;
    if !output.status.success() {
        return Err(RuntimeError::Io(io::Error::new(
            io::ErrorKind::NotFound,
            "process does not exist",
        )));
    }
    Ok(String::from_utf8(output.stdout)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        .trim()
        .to_owned())
}

#[cfg(target_os = "linux")]
fn process_executable(pid: u32) -> Result<PathBuf, RuntimeError> {
    Ok(fs::read_link(format!("/proc/{pid}/exe"))?.canonicalize()?)
}

#[cfg(target_os = "macos")]
fn process_executable(pid: u32) -> Result<PathBuf, RuntimeError> {
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let count = unsafe {
        libc::proc_pidpath(
            pid as i32,
            buffer.as_mut_ptr().cast(),
            u32::try_from(buffer.len()).unwrap(),
        )
    };
    if count <= 0 {
        return Err(RuntimeError::Io(io::Error::last_os_error()));
    }
    buffer.truncate(count as usize);
    Ok(PathBuf::from(std::ffi::OsString::from_vec(buffer)).canonicalize()?)
}
