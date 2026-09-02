use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use thiserror::Error;
use tokio::net::{UnixListener, UnixStream};

use super::RuntimePaths;

pub struct UnixEndpoint {
    listener: UnixListener,
    socket: SocketGuard,
    _lock: ServeLock,
}

impl UnixEndpoint {
    pub fn bind(paths: &RuntimePaths) -> Result<Self, UnixTransportError> {
        let serve_lock = ServeLock::acquire(&paths.serve_lock)?;
        remove_stale_socket(&paths.socket)?;
        let listener = UnixListener::bind(&paths.socket)?;
        fs::set_permissions(&paths.socket, fs::Permissions::from_mode(0o600))?;
        let metadata = fs::symlink_metadata(&paths.socket)?;
        let socket = SocketGuard {
            path: paths.socket.clone(),
            device: metadata.dev(),
            inode: metadata.ino(),
            uid: metadata.uid(),
        };
        Ok(Self {
            listener,
            socket,
            _lock: serve_lock,
        })
    }

    pub async fn accept(&self) -> Result<UnixStream, UnixTransportError> {
        let (stream, _) = self.listener.accept().await?;
        verify_peer_uid(&stream)?;
        Ok(stream)
    }

    pub fn path(&self) -> &Path {
        &self.socket.path
    }
}

struct ServeLock {
    file: File,
}

impl ServeLock {
    fn acquire(path: &Path) -> Result<Self, UnixTransportError> {
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)?;
        let metadata = file.metadata()?;
        let uid = unsafe { libc::getuid() };
        if !metadata.file_type().is_file() || metadata.uid() != uid {
            return Err(UnixTransportError::UnsafeServeLock {
                path: path.to_path_buf(),
            });
        }
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result != 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::WouldBlock {
                return Err(UnixTransportError::AlreadyServing {
                    path: path.to_path_buf(),
                });
            }
            return Err(error.into());
        }
        Ok(Self { file })
    }
}

impl Drop for ServeLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

struct SocketGuard {
    path: PathBuf,
    device: u64,
    inode: u64,
    uid: u32,
}

impl Drop for SocketGuard {
    fn drop(&mut self) {
        let Ok(metadata) = fs::symlink_metadata(&self.path) else {
            return;
        };
        if metadata.file_type().is_socket()
            && metadata.dev() == self.device
            && metadata.ino() == self.inode
            && metadata.uid() == self.uid
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn remove_stale_socket(path: &Path) -> Result<(), UnixTransportError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let uid = unsafe { libc::getuid() };
    if !metadata.file_type().is_socket() || metadata.uid() != uid {
        return Err(UnixTransportError::UnsafeSocketPath {
            path: path.to_path_buf(),
        });
    }
    match std::os::unix::net::UnixStream::connect(path) {
        Ok(_) => {
            return Err(UnixTransportError::AlreadyServing {
                path: path.to_path_buf(),
            });
        }
        Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    }
    let current = fs::symlink_metadata(path)?;
    if !current.file_type().is_socket()
        || current.uid() != uid
        || current.dev() != metadata.dev()
        || current.ino() != metadata.ino()
    {
        return Err(UnixTransportError::SocketChanged {
            path: path.to_path_buf(),
        });
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn verify_peer_uid(stream: &UnixStream) -> Result<(), UnixTransportError> {
    let expected = unsafe { libc::getuid() };
    verify_peer_uid_against(stream, expected)
}

pub fn verify_peer_uid_against(
    stream: &UnixStream,
    expected: u32,
) -> Result<(), UnixTransportError> {
    let received = peer_uid(stream)?;
    if received == expected {
        Ok(())
    } else {
        Err(UnixTransportError::PeerUid { expected, received })
    }
}

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
))]
fn peer_uid(stream: &UnixStream) -> Result<u32, UnixTransportError> {
    let mut uid = 0;
    let mut gid = 0;
    let result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if result == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error().into())
    }
}

#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> Result<u32, UnixTransportError> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&raw mut credentials).cast(),
            &raw mut length,
        )
    };
    if result == 0 {
        Ok(credentials.uid)
    } else {
        Err(io::Error::last_os_error().into())
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly",
    target_os = "linux"
)))]
compile_error!("supaterm-host requires peer credential support");

#[derive(Debug, Error)]
pub enum UnixTransportError {
    #[error("a host already holds {path}")]
    AlreadyServing { path: PathBuf },
    #[error("refusing unsafe serve lock {path}")]
    UnsafeServeLock { path: PathBuf },
    #[error("refusing to replace unsafe socket path {path}")]
    UnsafeSocketPath { path: PathBuf },
    #[error("socket path changed while checking staleness: {path}")]
    SocketChanged { path: PathBuf },
    #[error("peer UID {received} does not match host UID {expected}")]
    PeerUid { expected: u32, received: u32 },
    #[error(transparent)]
    Io(#[from] io::Error),
}
