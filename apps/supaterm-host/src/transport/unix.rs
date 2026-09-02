use crate::host::actor::HostActor;
use crate::protocol::connection::ConnectionSession;
use crate::protocol::control::{HostControl, decode_client_control, encode_control};
use crate::protocol::frame::{Direction, Frame, FrameKind};
use crate::protocol::io::{FrameReader, FrameWriter};
use crate::runtime::{RuntimeError, RuntimePaths, ServeLock, SocketState};
use bytes::Bytes;
use std::fs;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tokio::net::{UnixListener, UnixStream};

pub struct UnixServer {
    listener: UnixListener,
    socket: PathBuf,
    lock: ServeLock,
}

impl UnixServer {
    pub async fn bind(paths: &RuntimePaths) -> Result<Self, RuntimeError> {
        let lock = paths.acquire_serve_lock()?;
        if paths.prepare_socket()? == SocketState::Live {
            return Err(RuntimeError::AlreadyServing);
        }
        let listener = UnixListener::bind(&paths.socket)?;
        fs::set_permissions(&paths.socket, fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            socket: paths.socket.clone(),
            lock,
        })
    }

    pub async fn accept(&self) -> io::Result<(UnixStream, tokio::net::unix::SocketAddr)> {
        self.listener.accept().await
    }
}

impl Drop for UnixServer {
    fn drop(&mut self) {
        let _ = &self.lock;
        if let Ok(metadata) = fs::symlink_metadata(&self.socket)
            && std::os::unix::fs::FileTypeExt::is_socket(&metadata.file_type())
        {
            let _ = fs::remove_file(&self.socket);
        }
    }
}

pub async fn serve_connection(stream: UnixStream, actor: HostActor) -> io::Result<()> {
    let expected_uid = unsafe { libc::geteuid() };
    let actual_uid = peer_uid(&stream)?;
    if actual_uid != expected_uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("peer uid {actual_uid} does not match {expected_uid}"),
        ));
    }
    let (read_half, write_half) = stream.into_split();
    let mut reader = FrameReader::new(read_half, Direction::ClientToHost);
    let mut writer = FrameWriter::new(write_half);
    let mut session = ConnectionSession::new(actor);
    while let Some(frame) = reader.read().await? {
        if frame.kind != FrameKind::ClientControl {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "terminal data arrived before an attachment",
            ));
        }
        let response = match decode_client_control(&frame.payload) {
            Ok(control) => session.receive(control).await,
            Err(error) => HostControl::Error {
                command_id: None,
                error: crate::protocol::control::ProtocolError {
                    code: crate::protocol::control::ProtocolErrorCode::InvalidRequest,
                    details: serde_json::json!({"reason": error.to_string()}),
                    retryable: false,
                },
            },
        };
        writer
            .write(&Frame {
                kind: FrameKind::HostControl,
                stream_id: 0,
                payload: Bytes::from(encode_control(&response).map_err(io::Error::other)?),
            })
            .await?;
        if session.is_closed() {
            break;
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut uid = 0;
    let mut gid = 0;
    let result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if result == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
pub fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
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
        Err(io::Error::last_os_error())
    }
}
