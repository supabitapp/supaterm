use crate::protocol::control::HostId;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use uuid::Uuid;

const STATE_SCHEMA_VERSION: u32 = 1;

#[derive(Deserialize, Serialize)]
struct BootstrapState {
    schema_version: u32,
    host_id: HostId,
}

pub fn load_or_create_host_id(path: &Path) -> io::Result<HostId> {
    if let Ok(bytes) = fs::read(path)
        && let Ok(state) = serde_json::from_slice::<BootstrapState>(&bytes)
        && state.schema_version == STATE_SCHEMA_VERSION
    {
        return Ok(state.host_id);
    }
    let host_id = HostId(Uuid::new_v4());
    let state = BootstrapState {
        schema_version: STATE_SCHEMA_VERSION,
        host_id,
    };
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let bytes = serde_json::to_vec(&state).map_err(io::Error::other)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(host_id)
}
