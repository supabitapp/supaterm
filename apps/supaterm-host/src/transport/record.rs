use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::protocol::{BUILD_IDENTITY, PROTOCOL_VERSION};

use super::RuntimePaths;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostRuntimeRecord {
    pub pid: u32,
    pub uid: u32,
    pub process_start_identity: String,
    pub executable: PathBuf,
    pub protocol_version: u32,
    pub build_identity: String,
    pub socket: PathBuf,
}

impl HostRuntimeRecord {
    pub fn current(paths: &RuntimePaths) -> Result<Self, RuntimeRecordError> {
        Ok(Self {
            pid: std::process::id(),
            uid: unsafe { libc::getuid() },
            process_start_identity: process_start_identity()?,
            executable: fs::canonicalize(std::env::current_exe()?)?,
            protocol_version: PROTOCOL_VERSION,
            build_identity: BUILD_IDENTITY.to_owned(),
            socket: paths.socket.clone(),
        })
    }
}

pub struct RuntimeRecordGuard {
    path: PathBuf,
    record: HostRuntimeRecord,
}

impl RuntimeRecordGuard {
    pub fn write(paths: &RuntimePaths) -> Result<Self, RuntimeRecordError> {
        let record = HostRuntimeRecord::current(paths)?;
        let temporary = paths.runtime_directory.join(format!(
            ".host-{}-{}.tmp",
            record.pid, record.process_start_identity
        ));
        let bytes = serde_json::to_vec(&record)?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &paths.start_record)?;
        fs::set_permissions(&paths.start_record, fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            path: paths.start_record.clone(),
            record,
        })
    }

    pub fn record(&self) -> &HostRuntimeRecord {
        &self.record
    }
}

impl Drop for RuntimeRecordGuard {
    fn drop(&mut self) {
        let Ok(bytes) = fs::read(&self.path) else {
            return;
        };
        let Ok(current) = serde_json::from_slice::<HostRuntimeRecord>(&bytes) else {
            return;
        };
        if current == self.record {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn process_start_identity() -> Result<String, RuntimeRecordError> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let expected = size_of::<libc::proc_bsdinfo>();
    let received = unsafe {
        libc::proc_pidinfo(
            std::process::id() as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            expected as i32,
        )
    };
    if received as usize != expected {
        return Err(io::Error::last_os_error().into());
    }
    let info = unsafe { info.assume_init() };
    Ok(format!(
        "{}.{:06}",
        info.pbi_start_tvsec, info.pbi_start_tvusec
    ))
}

#[cfg(target_os = "linux")]
fn process_start_identity() -> Result<String, RuntimeRecordError> {
    let stat = fs::read_to_string("/proc/self/stat")?;
    let fields = stat
        .rsplit_once(") ")
        .ok_or(RuntimeRecordError::InvalidProcessIdentity)?
        .1;
    fields
        .split_whitespace()
        .nth(19)
        .map(str::to_owned)
        .ok_or(RuntimeRecordError::InvalidProcessIdentity)
}

#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux")))]
fn process_start_identity() -> Result<String, RuntimeRecordError> {
    Err(RuntimeRecordError::InvalidProcessIdentity)
}

#[derive(Debug, Error)]
pub enum RuntimeRecordError {
    #[error("cannot determine process start identity")]
    InvalidProcessIdentity,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
