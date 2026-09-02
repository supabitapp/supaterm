use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use thiserror::Error;

const FREE_TAB_LIMIT: usize = 5;
const KEYCHAIN_BASE: &str = "app.supabit.supaterm.license";
const SERVICE_BASE_URL: &str = "https://license.supaterm.com";
const PRODUCTION_PUBLIC_KEY: [u8; 32] = [
    0xec, 0x8f, 0x0e, 0xab, 0x93, 0x1e, 0xef, 0xa0, 0xea, 0xdf, 0x06, 0xbb, 0xeb, 0xf4, 0xdf, 0x33,
    0x0a, 0x22, 0x22, 0x84, 0xda, 0x8b, 0x6b, 0x41, 0x0a, 0x79, 0x6e, 0x46, 0x85, 0xc9, 0xde, 0xaf,
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LicenseCredential {
    raw_value: String,
    license_id: String,
}

impl LicenseCredential {
    pub fn parse(value: &str) -> Option<Self> {
        let raw_value = value.trim().to_ascii_uppercase();
        let parts = raw_value.split('-').collect::<Vec<_>>();
        if parts.len() != 3
            || parts[0] != "SUPATERM"
            || parts[1].len() != 26
            || parts[2].len() != 26
        {
            return None;
        }
        let id = decode_base32(parts[1])?;
        let secret = decode_base32(parts[2])?;
        if id.len() != 16 || secret.len() != 16 {
            return None;
        }
        Some(Self {
            raw_value,
            license_id: id.iter().map(|byte| format!("{byte:02x}")).collect(),
        })
    }

    pub fn raw_value(&self) -> &str {
        &self.raw_value
    }

    pub fn license_id(&self) -> &str {
        &self.license_id
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntitlementStatus {
    Active,
    Deactivated,
    Revoked,
    Transferred,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LicenseEntitlement {
    pub license_id: String,
    pub device_id: String,
    pub status: EntitlementStatus,
    pub updates_through: Option<String>,
    pub revision: i64,
    pub issued_at: i64,
    pub revocation_reason: Option<String>,
    pub signed_token: String,
}

#[derive(Clone)]
pub struct EntitlementVerifier {
    public_key: VerifyingKey,
}

impl EntitlementVerifier {
    pub fn new(public_key: [u8; 32]) -> Result<Self, LicenseError> {
        Ok(Self {
            public_key: VerifyingKey::from_bytes(&public_key)
                .map_err(|_| LicenseError::InvalidEntitlement)?,
        })
    }

    pub fn production() -> Self {
        Self::new(PRODUCTION_PUBLIC_KEY).expect("valid production license public key")
    }

    pub fn decode(
        &self,
        token: &str,
        expected_device_id: &str,
        expected_license_id: &str,
    ) -> Option<LicenseEntitlement> {
        let parts = token.split('.').collect::<Vec<_>>();
        if parts.len() != 2 {
            return None;
        }
        let payload = decode_base64_url(parts[0])?;
        let signature_bytes: [u8; 64] = decode_base64_url(parts[1])?.try_into().ok()?;
        self.public_key
            .verify(&payload, &Signature::from_bytes(&signature_bytes))
            .ok()?;
        let claims: EntitlementClaims = serde_json::from_slice(&payload).ok()?;
        if claims.v != 1
            || claims.did != expected_device_id
            || claims.lid != expected_license_id
            || claims.rev < 0
            || claims.iat < 0
            || !claims.valid()
        {
            return None;
        }
        Some(LicenseEntitlement {
            license_id: claims.lid,
            device_id: claims.did,
            status: claims.status,
            updates_through: claims.upd,
            revision: claims.rev,
            issued_at: claims.iat,
            revocation_reason: claims.reason,
            signed_token: token.to_owned(),
        })
    }
}

#[derive(Deserialize)]
struct EntitlementClaims {
    v: u8,
    lid: String,
    did: String,
    status: EntitlementStatus,
    upd: Option<String>,
    rev: i64,
    iat: i64,
    reason: Option<String>,
}

impl EntitlementClaims {
    fn valid(&self) -> bool {
        let valid_day = self.upd.as_deref().is_none_or(valid_day);
        valid_day
            && match self.status {
                EntitlementStatus::Active => self.upd.is_some() && self.reason.is_none(),
                EntitlementStatus::Revoked => {
                    self.upd.is_none()
                        && self
                            .reason
                            .as_deref()
                            .is_some_and(|reason| !reason.is_empty())
                }
                EntitlementStatus::Deactivated | EntitlementStatus::Transferred => {
                    self.upd.is_none() && self.reason.is_none()
                }
            }
    }
}

#[derive(Clone, Debug)]
pub struct LicenseEnvironment {
    pub state_root: PathBuf,
    pub app_version: String,
    pub release_day: Option<String>,
    pub instance_name: Option<String>,
}

#[derive(Clone)]
pub struct LicenseService {
    inner: Arc<LicenseServiceInner>,
}

struct LicenseServiceInner {
    client: reqwest::Client,
    device: LicenseDevice,
    storage: LicenseStorage,
    verifier: EntitlementVerifier,
    state: RwLock<LicenseState>,
    release_day: Option<String>,
}

#[derive(Clone, Default)]
struct LicenseState {
    entitlement: Option<LicenseEntitlement>,
    has_license_key: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseMode {
    Free,
    Paid,
    Expired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LicenseStatus {
    pub mode: LicenseMode,
    pub license_id: Option<String>,
    pub updates_through: Option<String>,
    pub device_name: String,
    pub open_tab_count: usize,
    pub free_tab_limit: usize,
}

impl LicenseService {
    pub fn new(environment: LicenseEnvironment) -> Result<Self, LicenseError> {
        let device = LicenseDevice::current(&environment.app_version)?;
        let storage = LicenseStorage::new(environment.state_root, environment.instance_name);
        let verifier = EntitlementVerifier::production();
        let state = load_state(&storage, &verifier, &device);
        Ok(Self {
            inner: Arc::new(LicenseServiceInner {
                client: reqwest::Client::builder()
                    .timeout(Duration::from_secs(55))
                    .build()
                    .map_err(|_| LicenseError::ConnectionRequired)?,
                device,
                storage,
                verifier,
                state: RwLock::new(state),
                release_day: environment.release_day.filter(|value| valid_day(value)),
            }),
        })
    }

    pub fn free() -> Self {
        let state_root =
            std::env::temp_dir().join(format!("supaterm-license-{}", std::process::id()));
        Self {
            inner: Arc::new(LicenseServiceInner {
                client: reqwest::Client::new(),
                device: LicenseDevice {
                    id: "unavailable".into(),
                    name: "Unknown".into(),
                    app_version: env!("CARGO_PKG_VERSION").into(),
                },
                storage: LicenseStorage::new(
                    state_root,
                    Some(format!("free-{}", std::process::id())),
                ),
                verifier: EntitlementVerifier::production(),
                state: RwLock::new(LicenseState::default()),
                release_day: None,
            }),
        }
    }

    pub fn status(&self, open_tab_count: usize) -> LicenseStatus {
        let state = self.inner.state.read().unwrap();
        let mode = mode(
            state.entitlement.as_ref(),
            self.inner.release_day.as_deref(),
        );
        LicenseStatus {
            mode,
            license_id: state
                .entitlement
                .as_ref()
                .map(|entitlement| entitlement.license_id.clone()),
            updates_through: state
                .entitlement
                .as_ref()
                .and_then(|entitlement| entitlement.updates_through.clone()),
            device_name: self.inner.device.name.clone(),
            open_tab_count,
            free_tab_limit: FREE_TAB_LIMIT,
        }
    }

    pub fn permits_new_tab(&self, current_tab_count: usize) -> bool {
        self.status(current_tab_count).mode == LicenseMode::Paid
            || current_tab_count < FREE_TAB_LIMIT
    }

    pub fn buy_url(&self) -> String {
        format!("{SERVICE_BASE_URL}/buy")
    }

    pub fn renew_url(&self) -> Result<String, LicenseError> {
        self.inner
            .state
            .read()
            .unwrap()
            .entitlement
            .as_ref()
            .map(|entitlement| format!("{SERVICE_BASE_URL}/licenses/{}", entitlement.license_id))
            .ok_or(LicenseError::MissingLicenseKey)
    }

    pub async fn activate(&self, value: String) -> Result<LicenseStatus, LicenseError> {
        let credential = LicenseCredential::parse(&value).ok_or(LicenseError::InvalidLicenseKey)?;
        let body = ActivateRequest {
            app_version: self.inner.device.app_version.clone(),
            device_id: self.inner.device.id.clone(),
            device_name: self.inner.device.name.clone(),
            license_key: credential.raw_value.clone(),
        };
        let token = self.request("v1/activate", &body).await?;
        let entitlement = self
            .inner
            .verifier
            .decode(&token, &self.inner.device.id, &credential.license_id)
            .filter(|entitlement| entitlement.status == EntitlementStatus::Active)
            .ok_or(LicenseError::InvalidEntitlement)?;
        self.inner.storage.save(&credential.raw_value, &token)?;
        *self.inner.state.write().unwrap() = LicenseState {
            entitlement: Some(entitlement),
            has_license_key: true,
        };
        Ok(self.status(0))
    }

    pub async fn deactivate(&self) -> Result<LicenseStatus, LicenseError> {
        let credential = self.credential()?;
        let token = self
            .request(
                "v1/deactivate",
                &LicenseRequest {
                    device_id: self.inner.device.id.clone(),
                    license_key: credential.raw_value.clone(),
                },
            )
            .await?;
        let entitlement = self
            .inner
            .verifier
            .decode(&token, &self.inner.device.id, &credential.license_id)
            .filter(|entitlement| entitlement.status != EntitlementStatus::Active)
            .ok_or(LicenseError::InvalidEntitlement)?;
        let _ = entitlement;
        self.inner.storage.delete()?;
        *self.inner.state.write().unwrap() = LicenseState::default();
        Ok(self.status(0))
    }

    pub async fn refresh(&self) -> Result<LicenseStatus, LicenseError> {
        let credential = self.credential()?;
        let token = self
            .request(
                "v1/refresh",
                &LicenseRequest {
                    device_id: self.inner.device.id.clone(),
                    license_key: credential.raw_value.clone(),
                },
            )
            .await?;
        let received = self
            .inner
            .verifier
            .decode(&token, &self.inner.device.id, &credential.license_id)
            .ok_or(LicenseError::InvalidEntitlement)?;
        let current = self.inner.state.read().unwrap().entitlement.clone();
        let entitlement = if current
            .as_ref()
            .is_some_and(|current| current.revision >= received.revision)
        {
            current.unwrap()
        } else {
            self.inner.storage.save(&credential.raw_value, &token)?;
            received
        };
        *self.inner.state.write().unwrap() = LicenseState {
            entitlement: Some(entitlement),
            has_license_key: true,
        };
        Ok(self.status(0))
    }

    pub fn start_refresh_loop(&self) {
        if !self.inner.state.read().unwrap().has_license_key {
            return;
        }
        let service = self.clone();
        let jitter = service
            .inner
            .device
            .id
            .get(..4)
            .and_then(|value| u64::from_str_radix(value, 16).ok())
            .unwrap_or(0)
            % 3_601;
        tokio::spawn(async move {
            let interval = Duration::from_secs(84_600 + jitter);
            loop {
                tokio::time::sleep(interval).await;
                let _ = service.refresh().await;
            }
        });
    }

    fn credential(&self) -> Result<LicenseCredential, LicenseError> {
        self.inner
            .storage
            .load_key()?
            .as_deref()
            .and_then(LicenseCredential::parse)
            .ok_or(LicenseError::MissingLicenseKey)
    }

    async fn request<T: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<String, LicenseError> {
        let response = self
            .inner
            .client
            .post(format!("{SERVICE_BASE_URL}/{path}"))
            .json(body)
            .send()
            .await
            .map_err(|_| LicenseError::ConnectionRequired)?;
        if !response.status().is_success() {
            return Err(server_error(response.status(), response).await);
        }
        let response = response
            .json::<TokenResponse>()
            .await
            .map_err(|_| LicenseError::InvalidEntitlement)?;
        if response.token.is_empty() {
            return Err(LicenseError::InvalidEntitlement);
        }
        Ok(response.token)
    }
}

#[derive(Debug, Error)]
pub enum LicenseError {
    #[error("a network connection is required")]
    ConnectionRequired,
    #[error("the license server returned an invalid entitlement")]
    InvalidEntitlement,
    #[error("the license key is invalid")]
    InvalidLicenseKey,
    #[error("no license key is stored")]
    MissingLicenseKey,
    #[error("license service error {code}: {message}")]
    Server {
        code: String,
        message: String,
        device_name: Option<String>,
    },
    #[error("license storage failed")]
    Storage,
    #[error("device identity is unavailable")]
    DeviceIdentity,
}

#[derive(Clone)]
struct LicenseDevice {
    id: String,
    name: String,
    app_version: String,
}

impl LicenseDevice {
    fn current(app_version: &str) -> Result<Self, LicenseError> {
        let hardware_id = hardware_id().ok_or(LicenseError::DeviceIdentity)?;
        let id = Sha256::digest(format!("app.supabit.supaterm:device:v1:{hardware_id}").as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        Ok(Self {
            id,
            name: machine_name(),
            app_version: app_version.to_owned(),
        })
    }
}

#[derive(Clone)]
struct LicenseStorage {
    token_path: PathBuf,
    #[cfg(not(target_os = "macos"))]
    key_path: PathBuf,
    identifier: String,
}

impl LicenseStorage {
    fn new(state_root: PathBuf, instance_name: Option<String>) -> Self {
        let identifier = match instance_name.as_deref() {
            Some(name) if name != "default" => {
                let suffix = Sha256::digest(name.as_bytes())[..8]
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                format!("{KEYCHAIN_BASE}.{suffix}")
            }
            _ => KEYCHAIN_BASE.into(),
        };
        Self {
            token_path: state_root.join("license.token"),
            #[cfg(not(target_os = "macos"))]
            key_path: state_root.join("license.key"),
            identifier,
        }
    }

    fn load_key(&self) -> Result<Option<String>, LicenseError> {
        load_key(self)
    }

    fn load_token(&self) -> Option<String> {
        fs::read_to_string(&self.token_path).ok()
    }

    fn save(&self, key: &str, token: &str) -> Result<(), LicenseError> {
        let previous = self.load_token();
        write_private_file(&self.token_path, token.as_bytes())?;
        if let Err(error) = save_key(self, key) {
            match previous {
                Some(token) => {
                    let _ = write_private_file(&self.token_path, token.as_bytes());
                }
                None => {
                    let _ = fs::remove_file(&self.token_path);
                }
            }
            return Err(error);
        }
        Ok(())
    }

    fn delete(&self) -> Result<(), LicenseError> {
        delete_key(self)?;
        match fs::remove_file(&self.token_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(LicenseError::Storage),
        }
    }
}

#[derive(Serialize)]
struct ActivateRequest {
    app_version: String,
    device_id: String,
    device_name: String,
    license_key: String,
}

#[derive(Serialize)]
struct LicenseRequest {
    device_id: String,
    license_key: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    token: String,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: ErrorPayload,
}

#[derive(Deserialize)]
struct ErrorPayload {
    code: String,
    message: String,
    device_name: Option<String>,
}

async fn server_error(status: StatusCode, response: reqwest::Response) -> LicenseError {
    response
        .json::<ErrorResponse>()
        .await
        .map(|response| LicenseError::Server {
            code: response.error.code,
            message: response.error.message,
            device_name: response.error.device_name,
        })
        .unwrap_or_else(|_| LicenseError::Server {
            code: status.as_u16().to_string(),
            message: "invalid server response".into(),
            device_name: None,
        })
}

fn load_state(
    storage: &LicenseStorage,
    verifier: &EntitlementVerifier,
    device: &LicenseDevice,
) -> LicenseState {
    let credential = storage
        .load_key()
        .ok()
        .flatten()
        .and_then(|value| LicenseCredential::parse(&value));
    let entitlement = credential.as_ref().and_then(|credential| {
        storage
            .load_token()
            .and_then(|token| verifier.decode(&token, &device.id, credential.license_id()))
    });
    LicenseState {
        entitlement,
        has_license_key: credential.is_some(),
    }
}

fn mode(entitlement: Option<&LicenseEntitlement>, release_day: Option<&str>) -> LicenseMode {
    let Some(entitlement) = entitlement.filter(|value| value.status == EntitlementStatus::Active)
    else {
        return LicenseMode::Free;
    };
    match (release_day, entitlement.updates_through.as_deref()) {
        (Some(release_day), Some(updates_through)) if release_day > updates_through => {
            LicenseMode::Expired
        }
        (_, Some(_)) => LicenseMode::Paid,
        _ => LicenseMode::Free,
    }
}

fn decode_base32(value: &str) -> Option<Vec<u8>> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = 0;
    let mut buffer = 0_u64;
    let mut decoded = Vec::new();
    for byte in value.bytes() {
        let index = alphabet.iter().position(|candidate| *candidate == byte)?;
        buffer = (buffer << 5) | index as u64;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            decoded.push(((buffer >> bits) & 255) as u8);
        }
    }
    (bits == 2 && buffer & 3 == 0).then_some(decoded)
}

fn decode_base64_url(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.contains('=') {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(value).ok()?;
    (URL_SAFE_NO_PAD.encode(&decoded) == value).then_some(decoded)
}

fn valid_day(value: &str) -> bool {
    if value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" {
        return false;
    }
    let year = value[..4].parse::<u16>().ok();
    let month = value[5..7].parse::<u8>().ok();
    let day = value[8..].parse::<u8>().ok();
    year.is_some_and(|year| year > 0)
        && month.is_some_and(|month| (1..=12).contains(&month))
        && day.is_some_and(|day| (1..=31).contains(&day))
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), LicenseError> {
    let parent = path.parent().ok_or(LicenseError::Storage)?;
    fs::create_dir_all(parent).map_err(|_| LicenseError::Storage)?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| LicenseError::Storage)?;
    file.write_all(bytes).map_err(|_| LicenseError::Storage)?;
    file.sync_all().map_err(|_| LicenseError::Storage)?;
    fs::rename(&temporary, path).map_err(|_| LicenseError::Storage)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| LicenseError::Storage)
}

#[cfg(target_os = "macos")]
fn load_key(storage: &LicenseStorage) -> Result<Option<String>, LicenseError> {
    match security_framework::passwords::get_generic_password(
        &storage.identifier,
        &storage.identifier,
    ) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| LicenseError::Storage),
        Err(error) if error.code() == -25_300 => Ok(None),
        Err(_) => Err(LicenseError::Storage),
    }
}

#[cfg(target_os = "macos")]
fn save_key(storage: &LicenseStorage, key: &str) -> Result<(), LicenseError> {
    security_framework::passwords::set_generic_password(
        &storage.identifier,
        &storage.identifier,
        key.as_bytes(),
    )
    .map_err(|_| LicenseError::Storage)
}

#[cfg(target_os = "macos")]
fn delete_key(storage: &LicenseStorage) -> Result<(), LicenseError> {
    match security_framework::passwords::delete_generic_password(
        &storage.identifier,
        &storage.identifier,
    ) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25_300 => Ok(()),
        Err(_) => Err(LicenseError::Storage),
    }
}

#[cfg(not(target_os = "macos"))]
fn load_key(storage: &LicenseStorage) -> Result<Option<String>, LicenseError> {
    match fs::read_to_string(&storage.key_path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(LicenseError::Storage),
    }
}

#[cfg(not(target_os = "macos"))]
fn save_key(storage: &LicenseStorage, key: &str) -> Result<(), LicenseError> {
    write_private_file(&storage.key_path, key.as_bytes())
}

#[cfg(not(target_os = "macos"))]
fn delete_key(storage: &LicenseStorage) -> Result<(), LicenseError> {
    match fs::remove_file(&storage.key_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(LicenseError::Storage),
    }
}

#[cfg(target_os = "macos")]
fn hardware_id() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .find(|line| line.contains("IOPlatformUUID"))?
        .split('"')
        .nth(3)
        .map(str::to_owned)
}

#[cfg(target_os = "linux")]
fn hardware_id() -> Option<String> {
    fs::read_to_string("/etc/machine-id")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn machine_name() -> String {
    #[cfg(target_os = "macos")]
    let command = ("/usr/sbin/scutil", vec!["--get", "ComputerName"]);
    #[cfg(not(target_os = "macos"))]
    let command = ("hostname", Vec::new());
    std::process::Command::new(command.0)
        .args(command.1)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unknown".into())
}
