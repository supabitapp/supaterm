use crate::agent::integration::{IntegrationError, IntegrationHealth, IntegrationManager};
use crate::agent::manifest::DetectionCatalog;
use crate::agent::skills::{SkillCatalog, SkillError};
use crate::protocol::control::ClientRole;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct MachineEnvironment {
    pub home_directory: PathBuf,
    pub state_root: PathBuf,
}

#[derive(Clone)]
pub struct MachineServices {
    inner: Arc<MachineServicesInner>,
}

struct MachineServicesInner {
    environment: MachineEnvironment,
    integrations: IntegrationManager,
    skills: SkillCatalog,
    mutation: Mutex<()>,
}

#[derive(Debug, Error)]
pub enum MachineServiceError {
    #[error("permission denied")]
    PermissionDenied,
    #[error("invalid request")]
    InvalidRequest,
    #[error("not found")]
    NotFound,
    #[error("machine service failed")]
    Internal,
}

impl MachineServices {
    pub fn new(environment: MachineEnvironment) -> Result<Self, MachineServiceError> {
        let catalog = DetectionCatalog::embedded().map_err(|_| MachineServiceError::Internal)?;
        Ok(Self {
            inner: Arc::new(MachineServicesInner {
                integrations: IntegrationManager::new(environment.home_directory.clone(), catalog),
                environment,
                skills: SkillCatalog,
                mutation: Mutex::new(()),
            }),
        })
    }

    pub fn handles(method: &str) -> bool {
        method.starts_with("skills.") || method.starts_with("integration.")
    }

    pub async fn execute(
        &self,
        role: ClientRole,
        method: &str,
        params: Value,
    ) -> Result<Value, MachineServiceError> {
        if !matches!(role, ClientRole::Ui | ClientRole::Cli) {
            return Err(MachineServiceError::PermissionDenied);
        }
        match method {
            "skills.list" if params.is_null() => {
                let catalog = self.inner.skills.clone();
                let skills = tokio::task::spawn_blocking(move || catalog.list())
                    .await
                    .map_err(|_| MachineServiceError::Internal)?
                    .map_err(machine_skill_error)?;
                Ok(json!({"skills": skills}))
            }
            "skills.get" => {
                let request = decode::<SkillGetRequest>(params)?;
                let catalog = self.inner.skills.clone();
                let skill =
                    tokio::task::spawn_blocking(move || catalog.get(&request.name, request.full))
                        .await
                        .map_err(|_| MachineServiceError::Internal)?
                        .map_err(machine_skill_error)?;
                serde_json::to_value(skill).map_err(|_| MachineServiceError::Internal)
            }
            "skills.path" => {
                let request = decode::<SkillRequest>(params)?;
                let catalog = self.inner.skills.clone();
                let state_root = self.inner.environment.state_root.clone();
                let path =
                    tokio::task::spawn_blocking(move || catalog.path(&state_root, &request.name))
                        .await
                        .map_err(|_| MachineServiceError::Internal)?
                        .map_err(machine_skill_error)?;
                Ok(json!({"path": path}))
            }
            "skills.install" if params.is_null() => {
                let _guard = self.inner.mutation.lock().await;
                let catalog = self.inner.skills.clone();
                let home = self.inner.environment.home_directory.clone();
                let path = tokio::task::spawn_blocking(move || catalog.install(&home))
                    .await
                    .map_err(|_| MachineServiceError::Internal)?
                    .map_err(machine_skill_error)?;
                Ok(json!({"path": path}))
            }
            "integration.health" => {
                let request = decode::<IntegrationRequest>(params)?;
                let available = self.available(&request.kind).await?;
                let integrations = self.inner.integrations.clone();
                let kind = request.kind.clone();
                let health =
                    tokio::task::spawn_blocking(move || integrations.health(&kind, available))
                        .await
                        .map_err(|_| MachineServiceError::Internal)?
                        .map_err(machine_integration_error)?;
                integration_result(request.kind, health)
            }
            "integration.setup" | "integration.repair" | "integration.remove" => {
                let request = decode::<IntegrationRequest>(params)?;
                let _guard = self.inner.mutation.lock().await;
                let available = self.available(&request.kind).await?;
                let integrations = self.inner.integrations.clone();
                let kind = request.kind.clone();
                let operation = method.to_owned();
                let health = tokio::task::spawn_blocking(move || match operation.as_str() {
                    "integration.setup" => integrations.setup(&kind, available),
                    "integration.repair" => integrations.repair(&kind, available),
                    _ => integrations.remove(&kind, available),
                })
                .await
                .map_err(|_| MachineServiceError::Internal)?
                .map_err(machine_integration_error)?;
                if method == "integration.setup" {
                    let catalog = self.inner.skills.clone();
                    let home = self.inner.environment.home_directory.clone();
                    tokio::task::spawn_blocking(move || catalog.install(&home))
                        .await
                        .map_err(|_| MachineServiceError::Internal)?
                        .map_err(machine_skill_error)?;
                }
                integration_result(request.kind, health)
            }
            _ if Self::handles(method) => Err(MachineServiceError::InvalidRequest),
            _ => Err(MachineServiceError::NotFound),
        }
    }

    pub async fn repair_installed(&self) {
        for kind in self.inner.integrations.kinds() {
            let Ok(available) = self.available(&kind).await else {
                continue;
            };
            let integrations = self.inner.integrations.clone();
            let kind_for_health = kind.clone();
            let Ok(Ok(health)) = tokio::task::spawn_blocking(move || {
                integrations.health(&kind_for_health, available)
            })
            .await
            else {
                continue;
            };
            if matches!(
                health,
                IntegrationHealth::Partial
                    | IntegrationHealth::Drifted
                    | IntegrationHealth::UnavailableInstalled
            ) {
                let integrations = self.inner.integrations.clone();
                let _ = tokio::task::spawn_blocking(move || integrations.repair(&kind, available))
                    .await;
            }
        }
    }

    async fn available(&self, kind: &str) -> Result<bool, MachineServiceError> {
        if !self
            .inner
            .integrations
            .kinds()
            .iter()
            .any(|value| value == kind)
        {
            return Err(MachineServiceError::NotFound);
        }
        let mut command = tokio::process::Command::new("/usr/bin/env");
        command.arg(kind).arg("--version").kill_on_drop(true);
        let status = tokio::time::timeout(Duration::from_secs(3), command.status()).await;
        Ok(matches!(status, Ok(Ok(status)) if status.success()))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SkillRequest {
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SkillGetRequest {
    name: String,
    #[serde(default)]
    full: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IntegrationRequest {
    kind: String,
}

fn decode<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, MachineServiceError> {
    serde_json::from_value(value).map_err(|_| MachineServiceError::InvalidRequest)
}

fn integration_result(
    kind: String,
    health: IntegrationHealth,
) -> Result<Value, MachineServiceError> {
    serde_json::to_value(json!({"kind": kind, "health": health}))
        .map_err(|_| MachineServiceError::Internal)
}

fn machine_skill_error(error: SkillError) -> MachineServiceError {
    match error {
        SkillError::NotFound => MachineServiceError::NotFound,
        SkillError::Invalid(_) | SkillError::Io(_) => MachineServiceError::Internal,
    }
}

fn machine_integration_error(error: IntegrationError) -> MachineServiceError {
    match error {
        IntegrationError::NotFound => MachineServiceError::NotFound,
        IntegrationError::InvalidSettings | IntegrationError::UnsafePath => {
            MachineServiceError::InvalidRequest
        }
        IntegrationError::Io(_) => MachineServiceError::Internal,
    }
}
