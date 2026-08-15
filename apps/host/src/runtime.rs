use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{self, Read, Write},
    os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use crate::{HostError, MachineId};

const DIRECTORY_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

#[derive(Clone, Debug)]
pub struct HostPaths {
    pub runtime_root: PathBuf,
    pub state_root: PathBuf,
    pub socket: PathBuf,
}

impl HostPaths {
    pub fn new(runtime_root: impl Into<PathBuf>, state_root: impl Into<PathBuf>) -> Self {
        let runtime_root = runtime_root.into();
        Self {
            socket: runtime_root.join("host.sock"),
            runtime_root,
            state_root: state_root.into(),
        }
    }

    pub fn prepare(&self) -> Result<PreparedRuntime, HostError> {
        secure_directory(&self.runtime_root)?;
        secure_directory(&self.state_root)?;

        let lock_path = self.runtime_root.join("host.lock");
        let lock = open_owner_file(&lock_path, true)
            .map_err(|_| HostError::InvalidLock(lock_path.clone()))?;
        lock.set_permissions(fs::Permissions::from_mode(FILE_MODE))?;
        lock.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => HostError::AlreadyRunning,
            TryLockError::Error(error) => HostError::Io(error),
        })?;

        remove_stale_socket(&self.socket)?;
        let machine_id = load_or_create_machine_id(&self.state_root)?;

        Ok(PreparedRuntime {
            _lock: lock,
            machine_id,
            socket: self.socket.clone(),
        })
    }
}

pub struct PreparedRuntime {
    _lock: File,
    pub machine_id: MachineId,
    socket: PathBuf,
}

impl PreparedRuntime {
    pub fn socket_path(&self) -> &Path {
        &self.socket
    }
}

fn secure_directory(path: &Path) -> Result<(), HostError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => validate_directory(path, &metadata)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
            validate_directory(path, &fs::symlink_metadata(path)?)?;
        }
        Err(error) => return Err(error.into()),
    }
    fs::set_permissions(path, fs::Permissions::from_mode(DIRECTORY_MODE))?;
    Ok(())
}

fn validate_directory(path: &Path, metadata: &fs::Metadata) -> Result<(), HostError> {
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(HostError::InvalidRoot(path.to_path_buf()));
    }
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(HostError::RootOwner(path.to_path_buf()));
    }
    Ok(())
}

fn remove_stale_socket(path: &Path) -> Result<(), HostError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(HostError::UnsafeSocket(path.to_path_buf()));
    }
    if std::os::unix::net::UnixStream::connect(path).is_ok() {
        return Err(HostError::SocketInUse(path.to_path_buf()));
    }
    fs::remove_file(path)?;
    Ok(())
}

fn load_or_create_machine_id(state_root: &Path) -> Result<MachineId, HostError> {
    let path = state_root.join("machine-id");
    match read_machine_id(&path) {
        Ok(machine_id) => return Ok(machine_id),
        Err(HostError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let machine_id = MachineId::new();
    let temporary = state_root.join(format!("machine-id.{}.tmp", MachineId::new()));
    let create_result = (|| -> Result<(), HostError> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(FILE_MODE)
            .open(&temporary)?;
        file.write_all(machine_id.to_string().as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        match fs::hard_link(&temporary, &path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error.into()),
        }
    })();
    let _ = fs::remove_file(&temporary);
    create_result?;
    read_machine_id(&path)
}

fn read_machine_id(path: &Path) -> Result<MachineId, HostError> {
    let mut file = match open_owner_file(path, false) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(error.into()),
        Err(_) => return Err(HostError::InvalidMachineId(path.to_path_buf())),
    };
    file.set_permissions(fs::Permissions::from_mode(FILE_MODE))?;
    let mut value = String::new();
    file.read_to_string(&mut value)?;
    value
        .trim()
        .parse()
        .map_err(|_| HostError::InvalidMachineId(path.to_path_buf()))
}

fn open_owner_file(path: &Path, create: bool) -> io::Result<File> {
    let file = OpenOptions::new()
        .create(create)
        .read(true)
        .write(create)
        .mode(FILE_MODE)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file must be a regular file owned by the current user",
        ));
    }
    Ok(file)
}
