use crate::agent::manifest::{DetectionCatalog, IntegrationDescriptor};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

const MAXIMUM_SETTINGS_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct IntegrationManager {
    home: PathBuf,
    catalog: DetectionCatalog,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationHealth {
    Unavailable,
    UnavailableInstalled,
    Absent,
    Partial,
    Drifted,
    Healthy,
}

#[derive(Debug, Error)]
pub enum IntegrationError {
    #[error("integration not found")]
    NotFound,
    #[error("integration settings are invalid")]
    InvalidSettings,
    #[error("unsafe integration path")]
    UnsafePath,
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl IntegrationManager {
    pub fn new(home: PathBuf, catalog: DetectionCatalog) -> Self {
        Self { home, catalog }
    }

    pub fn kinds(&self) -> Vec<String> {
        self.catalog
            .manifests()
            .iter()
            .filter(|manifest| manifest.integration.is_some())
            .map(|manifest| manifest.id.clone())
            .collect()
    }

    pub fn health(
        &self,
        kind: &str,
        available: bool,
    ) -> Result<IntegrationHealth, IntegrationError> {
        let (descriptor, path) = self.resolve(kind)?;
        let Some(root) = read_root(&path)? else {
            return Ok(if available {
                IntegrationHealth::Absent
            } else {
                IntegrationHealth::Unavailable
            });
        };
        let managed = managed_groups(&root)?;
        let health = if managed.is_empty() {
            IntegrationHealth::Absent
        } else if managed.len() != 1 {
            IntegrationHealth::Drifted
        } else if canonical_managed_group(&managed[0], kind) && defaults_match(&root, descriptor)? {
            IntegrationHealth::Healthy
        } else {
            IntegrationHealth::Partial
        };
        Ok(if !available && health != IntegrationHealth::Absent {
            IntegrationHealth::UnavailableInstalled
        } else if !available {
            IntegrationHealth::Unavailable
        } else {
            health
        })
    }

    pub fn setup(
        &self,
        kind: &str,
        available: bool,
    ) -> Result<IntegrationHealth, IntegrationError> {
        if !available {
            return self.health(kind, false);
        }
        let (descriptor, path) = self.resolve(kind)?;
        let mut root = read_root(&path)?.unwrap_or_default();
        let mut owned_defaults = managed_defaults(&root, kind)?;
        remove_managed(&mut root)?;
        for (key, value) in &descriptor.defaults {
            let value =
                serde_json::to_value(value).map_err(|_| IntegrationError::InvalidSettings)?;
            if !root.contains_key(key) {
                root.insert(key.clone(), value.clone());
                owned_defaults.insert(key.clone(), value);
            } else if owned_defaults.get(key) != root.get(key) {
                owned_defaults.remove(key);
            }
        }
        let hooks = root
            .entry("hooks")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or(IntegrationError::InvalidSettings)?;
        let groups = hooks
            .entry("SessionStart")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or(IntegrationError::InvalidSettings)?;
        groups.push(canonical_group(kind, owned_defaults));
        write_root(&self.home, &path, &root)?;
        self.health(kind, true)
    }

    pub fn repair(
        &self,
        kind: &str,
        available: bool,
    ) -> Result<IntegrationHealth, IntegrationError> {
        self.setup(kind, available)
    }

    pub fn remove(
        &self,
        kind: &str,
        available: bool,
    ) -> Result<IntegrationHealth, IntegrationError> {
        let (_, path) = self.resolve(kind)?;
        let Some(mut root) = read_root(&path)? else {
            return self.health(kind, available);
        };
        let owned_defaults = managed_defaults(&root, kind)?;
        remove_managed(&mut root)?;
        for (key, value) in owned_defaults {
            if root.get(&key) == Some(&value) {
                root.remove(&key);
            }
        }
        write_root(&self.home, &path, &root)?;
        self.health(kind, available)
    }

    fn resolve(&self, kind: &str) -> Result<(&IntegrationDescriptor, PathBuf), IntegrationError> {
        let manifest = self
            .catalog
            .manifests()
            .iter()
            .find(|manifest| manifest.id == kind)
            .ok_or(IntegrationError::NotFound)?;
        let descriptor = manifest
            .integration
            .as_ref()
            .ok_or(IntegrationError::NotFound)?;
        if !valid_component(&manifest.id) || !valid_component(&descriptor.settings_file) {
            return Err(IntegrationError::UnsafePath);
        }
        Ok((
            descriptor,
            self.home
                .join(format!(".{}", manifest.id))
                .join(&descriptor.settings_file),
        ))
    }
}

fn canonical_group(kind: &str, defaults: Map<String, Value>) -> Value {
    json!({
        "supaterm_host": 1,
        "defaults": defaults,
        "hooks": [{
            "type": "command",
            "command": format!(
                "[ -x \"${{SUPATERM_CLI_PATH:-}}\" ] && \"$SUPATERM_CLI_PATH\" agent receive --kind {kind} || cat >/dev/null || true"
            ),
            "timeout": 10
        }]
    })
}

fn canonical_managed_group(group: &Value, kind: &str) -> bool {
    let defaults = group
        .get("defaults")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    group == &canonical_group(kind, defaults)
}

fn managed_defaults(
    root: &Map<String, Value>,
    kind: &str,
) -> Result<Map<String, Value>, IntegrationError> {
    let groups = managed_groups(root)?;
    if groups.len() != 1 || !canonical_managed_group(&groups[0], kind) {
        return Ok(Map::new());
    }
    Ok(groups[0]
        .get("defaults")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default())
}

fn defaults_match(
    root: &Map<String, Value>,
    descriptor: &IntegrationDescriptor,
) -> Result<bool, IntegrationError> {
    for (key, value) in &descriptor.defaults {
        let value = serde_json::to_value(value).map_err(|_| IntegrationError::InvalidSettings)?;
        if root.get(key) != Some(&value) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn managed_groups(root: &Map<String, Value>) -> Result<Vec<Value>, IntegrationError> {
    let Some(hooks) = root.get("hooks") else {
        return Ok(Vec::new());
    };
    let hooks = hooks.as_object().ok_or(IntegrationError::InvalidSettings)?;
    let mut managed = Vec::new();
    for groups in hooks.values() {
        for group in groups.as_array().ok_or(IntegrationError::InvalidSettings)? {
            if group.get("supaterm_host") == Some(&Value::from(1)) {
                managed.push(group.clone());
            }
        }
    }
    Ok(managed)
}

fn remove_managed(root: &mut Map<String, Value>) -> Result<(), IntegrationError> {
    let Some(hooks) = root.get_mut("hooks") else {
        return Ok(());
    };
    let hooks = hooks
        .as_object_mut()
        .ok_or(IntegrationError::InvalidSettings)?;
    for groups in hooks.values_mut() {
        let groups = groups
            .as_array_mut()
            .ok_or(IntegrationError::InvalidSettings)?;
        groups.retain(|group| group.get("supaterm_host") != Some(&Value::from(1)));
    }
    hooks.retain(|_, groups| groups.as_array().is_some_and(|groups| !groups.is_empty()));
    if hooks.is_empty() {
        root.remove("hooks");
    }
    Ok(())
}

fn read_root(path: &Path) -> Result<Option<Map<String, Value>>, IntegrationError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAXIMUM_SETTINGS_BYTES
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(IntegrationError::UnsafePath);
    }
    serde_json::from_slice::<Value>(&fs::read(path)?)
        .map_err(|_| IntegrationError::InvalidSettings)?
        .as_object()
        .cloned()
        .map(Some)
        .ok_or(IntegrationError::InvalidSettings)
}

fn write_root(home: &Path, path: &Path, root: &Map<String, Value>) -> Result<(), IntegrationError> {
    let parent = path.parent().ok_or(IntegrationError::UnsafePath)?;
    ensure_parent(home, parent)?;
    if let Ok(metadata) = fs::symlink_metadata(path)
        && (!metadata.file_type().is_file() || metadata.file_type().is_symlink())
    {
        return Err(IntegrationError::UnsafePath);
    }
    let temporary = parent.join(format!(".supaterm-host-{}", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&temporary)?;
    let bytes = serde_json::to_vec_pretty(&Value::Object(root.clone()))
        .map_err(|_| IntegrationError::InvalidSettings)?;
    file.write_all(&bytes)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

fn ensure_parent(home: &Path, parent: &Path) -> Result<(), IntegrationError> {
    if !home.is_dir() || !parent.starts_with(home) {
        return Err(IntegrationError::UnsafePath);
    }
    if let Ok(metadata) = fs::symlink_metadata(parent) {
        if !metadata.file_type().is_dir()
            || metadata.file_type().is_symlink()
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(IntegrationError::UnsafePath);
        }
    } else {
        fs::create_dir(parent)?;
    }
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.contains('/')
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}
