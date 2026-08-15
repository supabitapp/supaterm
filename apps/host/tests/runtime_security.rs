use std::os::unix::fs::{PermissionsExt, symlink};

use supaterm_host::{HostConfig, HostError, HostServer};
use tempfile::tempdir;

#[tokio::test]
async fn host_refuses_lock_symlinks_without_changing_the_target() {
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let target = directory.path().join("target");
    std::fs::create_dir(&runtime_root).unwrap();
    std::fs::set_permissions(&runtime_root, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(&target, b"unchanged").unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
    let lock = runtime_root.join("host.lock");
    symlink(&target, &lock).unwrap();

    let error = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap_err();

    assert!(matches!(error, HostError::InvalidLock(path) if path == lock));
    assert_eq!(std::fs::read(&target).unwrap(), b"unchanged");
    assert_eq!(
        std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o644
    );
}

#[tokio::test]
async fn host_refuses_machine_identity_symlinks_without_changing_the_target() {
    let directory = tempdir().unwrap();
    let runtime_root = directory.path().join("runtime");
    let state_root = directory.path().join("state");
    let target = directory.path().join("target");
    std::fs::create_dir(&state_root).unwrap();
    std::fs::set_permissions(&state_root, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(&target, b"unchanged").unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
    let machine_id = state_root.join("machine-id");
    symlink(&target, &machine_id).unwrap();

    let error = HostServer::bind(HostConfig::new(&runtime_root, &state_root))
        .await
        .unwrap_err();

    assert!(matches!(error, HostError::InvalidMachineId(path) if path == machine_id));
    assert_eq!(std::fs::read(&target).unwrap(), b"unchanged");
    assert_eq!(
        std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o644
    );
}
