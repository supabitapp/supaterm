use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use supaterm_host::runtime::{PathConfiguration, RuntimeError, RuntimePaths, SocketState};
use tempfile::tempdir;

fn configuration(root: &std::path::Path) -> PathConfiguration {
    PathConfiguration {
        state_home: Some(root.join("state")),
        home_directory: root.join("home"),
        xdg_runtime_directory: Some(root.join("runtime")),
        temporary_directory: root.join("tmp"),
        uid: unsafe { libc::geteuid() },
    }
}

#[test]
fn explicit_state_root_gets_a_private_short_runtime() {
    let root = tempdir().unwrap();

    let paths = RuntimePaths::initialize(configuration(root.path())).unwrap();

    assert_eq!(
        paths.state_root,
        root.path().join("state").canonicalize().unwrap()
    );
    assert_eq!(
        fs::metadata(&paths.runtime_directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert!(paths.socket.as_os_str().as_encoded_bytes().len() < 104);
    assert_eq!(paths.socket.file_name().unwrap(), "host.sock");
}

#[test]
fn a_long_xdg_path_uses_the_temporary_fallback() {
    let root = tempdir().unwrap();
    let mut configuration = configuration(root.path());
    configuration.xdg_runtime_directory = Some(root.path().join("x".repeat(120)));

    let paths = RuntimePaths::initialize(configuration.clone()).unwrap();

    assert!(
        paths
            .runtime_directory
            .starts_with(configuration.temporary_directory)
    );
}

#[test]
fn only_one_serve_lock_can_be_held() {
    let root = tempdir().unwrap();
    let paths = RuntimePaths::initialize(configuration(root.path())).unwrap();
    let first = paths.acquire_serve_lock().unwrap();

    assert!(matches!(
        paths.acquire_serve_lock(),
        Err(RuntimeError::AlreadyServing)
    ));

    drop(first);
    paths.acquire_serve_lock().unwrap();
}

#[test]
fn stale_socket_is_removed_but_live_socket_and_plain_file_are_preserved() {
    let root = tempdir().unwrap();
    let paths = RuntimePaths::initialize(configuration(root.path())).unwrap();
    let listener = UnixListener::bind(&paths.socket).unwrap();

    assert_eq!(paths.prepare_socket().unwrap(), SocketState::Live);
    assert!(paths.socket.exists());

    drop(listener);
    assert_eq!(paths.prepare_socket().unwrap(), SocketState::RemovedStale);
    assert!(!paths.socket.exists());

    fs::write(&paths.socket, b"not a socket").unwrap();
    assert!(matches!(
        paths.prepare_socket(),
        Err(RuntimeError::UnsafeSocketPath(_))
    ));
    assert_eq!(fs::read(&paths.socket).unwrap(), b"not a socket");
}
