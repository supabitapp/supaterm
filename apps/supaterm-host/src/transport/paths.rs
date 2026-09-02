use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use thiserror::Error;

const PORTABLE_SOCKET_PATH_LIMIT: usize = 100;

#[derive(Clone, Debug)]
pub struct PathEnvironment {
    pub state_home: Option<OsString>,
    pub xdg_runtime_dir: Option<OsString>,
    pub home: Option<OsString>,
    pub temporary_directory: PathBuf,
    pub current_directory: PathBuf,
    pub uid: u32,
}

impl PathEnvironment {
    pub fn current() -> Result<Self, RuntimePathsError> {
        Ok(Self {
            state_home: env::var_os("SUPATERM_STATE_HOME"),
            xdg_runtime_dir: env::var_os("XDG_RUNTIME_DIR"),
            home: env::var_os("HOME"),
            temporary_directory: env::temp_dir(),
            current_directory: env::current_dir()?,
            uid: unsafe { libc::getuid() },
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePaths {
    pub state_root: PathBuf,
    pub runtime_directory: PathBuf,
    pub socket: PathBuf,
    pub serve_lock: PathBuf,
    pub start_record: PathBuf,
}

impl RuntimePaths {
    pub fn resolve() -> Result<Self, RuntimePathsError> {
        Self::resolve_from(PathEnvironment::current()?)
    }

    pub fn resolve_from(environment: PathEnvironment) -> Result<Self, RuntimePathsError> {
        let home = environment.home.map(PathBuf::from);
        let configured_state_root = match normalized(environment.state_home)? {
            Some(path) => expand_tilde(path, home.as_deref())?,
            None => home
                .ok_or(RuntimePathsError::MissingHome)?
                .join(".config/supaterm"),
        };
        let state_root = absolute_path(configured_state_root, &environment.current_directory);
        let mut state_root_builder = fs::DirBuilder::new();
        state_root_builder.recursive(true).mode(0o700);
        state_root_builder.create(&state_root)?;
        let state_root = fs::canonicalize(state_root)?;
        ensure_private_directory(&state_root, environment.uid)?;
        let hash = state_root_hash(&state_root);
        let temporary_root = if environment.temporary_directory.is_absolute() {
            environment.temporary_directory
        } else {
            PathBuf::from("/tmp")
        };
        let temporary = temporary_root
            .join(format!("supaterm-{}", environment.uid))
            .join(&hash);
        let preferred = normalized(environment.xdg_runtime_dir)?
            .filter(|path| path.is_absolute())
            .map(|path| path.join("supaterm").join(&hash))
            .unwrap_or_else(|| temporary.clone());
        let system_temporary = PathBuf::from("/tmp")
            .join(format!("supaterm-{}", environment.uid))
            .join(&hash);
        let runtime_directory = [preferred, temporary, system_temporary]
            .into_iter()
            .find(|directory| socket_path_fits(&directory.join("host.sock")))
            .ok_or_else(|| RuntimePathsError::SocketPathTooLong {
                path: PathBuf::from("/tmp").join(format!("supaterm-{}", environment.uid)),
            })?;
        let runtime_parent = runtime_directory.parent().ok_or_else(|| {
            RuntimePathsError::UnsafeRuntimeDirectory {
                path: runtime_directory.clone(),
            }
        })?;
        ensure_private_directory(runtime_parent, environment.uid)?;
        ensure_private_directory(&runtime_directory, environment.uid)?;
        let socket = runtime_directory.join("host.sock");
        if !socket_path_fits(&socket) {
            return Err(RuntimePathsError::SocketPathTooLong { path: socket });
        }
        Ok(Self {
            state_root,
            socket,
            serve_lock: runtime_directory.join("serve.lock"),
            start_record: runtime_directory.join("host.json"),
            runtime_directory,
        })
    }

    pub fn for_socket(socket: impl Into<PathBuf>) -> Result<Self, RuntimePathsError> {
        let socket = socket.into();
        if !socket.is_absolute() {
            return Err(RuntimePathsError::SocketPathNotAbsolute { path: socket });
        }
        if !socket_path_fits(&socket) {
            return Err(RuntimePathsError::SocketPathTooLong { path: socket });
        }
        let runtime_directory = socket
            .parent()
            .ok_or_else(|| RuntimePathsError::SocketPathNotAbsolute {
                path: socket.clone(),
            })?
            .to_path_buf();
        ensure_explicit_socket_directory(&runtime_directory, unsafe { libc::getuid() })?;
        let file_name = socket.file_name().and_then(OsStr::to_str).ok_or_else(|| {
            RuntimePathsError::InvalidSocketName {
                path: socket.clone(),
            }
        })?;
        Ok(Self {
            state_root: runtime_directory.clone(),
            serve_lock: runtime_directory.join(format!("{file_name}.lock")),
            start_record: runtime_directory.join(format!("{file_name}.json")),
            runtime_directory,
            socket,
        })
    }

    pub fn host_id(&self) -> String {
        format!("host-{}", state_root_hash(&self.state_root))
    }
}

fn absolute_path(path: PathBuf, current_directory: &Path) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        current_directory.join(path)
    }
}

fn normalized(path: Option<OsString>) -> Result<Option<PathBuf>, RuntimePathsError> {
    let Some(path) = path else {
        return Ok(None);
    };
    let path = path
        .into_string()
        .map_err(|_| RuntimePathsError::InvalidEnvironmentPath)?;
    let path = path.trim();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(PathBuf::from(path)))
    }
}

fn expand_tilde(path: PathBuf, home: Option<&Path>) -> Result<PathBuf, RuntimePathsError> {
    if path == Path::new("~") {
        Ok(home.ok_or(RuntimePathsError::MissingHome)?.to_path_buf())
    } else if let Ok(suffix) = path.strip_prefix("~/") {
        Ok(home.ok_or(RuntimePathsError::MissingHome)?.join(suffix))
    } else {
        Ok(path)
    }
}

fn state_root_hash(path: &Path) -> String {
    let digest = Sha256::digest(path.as_os_str().as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn socket_path_fits(path: &Path) -> bool {
    path.as_os_str().as_bytes().len() <= PORTABLE_SOCKET_PATH_LIMIT
}

fn ensure_private_directory(path: &Path, uid: u32) -> Result<(), RuntimePathsError> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true).mode(0o700);
    builder.create(path)?;
    validate_owned_directory(path, uid)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn ensure_explicit_socket_directory(path: &Path, uid: u32) -> Result<(), RuntimePathsError> {
    match fs::symlink_metadata(path) {
        Ok(_) => validate_private_directory(path, uid),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            ensure_private_directory(path, uid)
        }
        Err(error) => Err(error.into()),
    }
}

fn validate_private_directory(path: &Path, uid: u32) -> Result<(), RuntimePathsError> {
    let metadata = validate_owned_directory(path, uid)?;
    if metadata.permissions().mode() & 0o777 != 0o700 {
        return Err(RuntimePathsError::UnsafeRuntimeDirectory {
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

fn validate_owned_directory(path: &Path, uid: u32) -> Result<fs::Metadata, RuntimePathsError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(RuntimePathsError::UnsafeRuntimeDirectory {
            path: path.to_path_buf(),
        });
    }
    if metadata.uid() != uid {
        return Err(RuntimePathsError::WrongOwner {
            path: path.to_path_buf(),
            expected: uid,
            received: metadata.uid(),
        });
    }
    Ok(metadata)
}

#[derive(Debug, Error)]
pub enum RuntimePathsError {
    #[error("HOME is required when SUPATERM_STATE_HOME is unset")]
    MissingHome,
    #[error("environment path is not valid UTF-8")]
    InvalidEnvironmentPath,
    #[error("socket path must be absolute: {path}")]
    SocketPathNotAbsolute { path: PathBuf },
    #[error("socket path is too long: {path}")]
    SocketPathTooLong { path: PathBuf },
    #[error("socket path has an invalid file name: {path}")]
    InvalidSocketName { path: PathBuf },
    #[error("runtime path is not a private directory: {path}")]
    UnsafeRuntimeDirectory { path: PathBuf },
    #[error("{path} belongs to UID {received}, expected {expected}")]
    WrongOwner {
        path: PathBuf,
        expected: u32,
        received: u32,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
