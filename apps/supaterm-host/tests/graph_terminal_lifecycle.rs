use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Duration;
use supaterm_host::host::actor::{HostActor, HostConfiguration};
use supaterm_host::protocol::connection::ConnectionSession;
use supaterm_host::protocol::control::{
    BuildIdentity, ClientControl, ClientId, ClientRole, CommandId, HostControl, HostId, Limits,
    PROTOCOL_VERSION, ProtocolErrorCode,
};
use supaterm_host::protocol::terminal::PaneId;
use supaterm_host::terminal::actor::PaneInfo;
use supaterm_host::terminal::pty::{SpawnSpec, TerminalEnvironment};
use supaterm_host::workspace::model::{ItemId, Placement, RootPlacement, SpaceId, TabId, WindowId};
use supaterm_host::workspace::reducer::Command;
use supaterm_host::workspace::replay::{ApplyResult, ModelSnapshot};
use supaterm_host::workspace::runtime::{PaneLifecycle, ProgressState};
use tempfile::tempdir;
use uuid::Uuid;

fn build() -> BuildIdentity {
    BuildIdentity {
        version: "26.0.0".into(),
        fingerprint: "build-a".into(),
    }
}

async fn session(environment: Option<TerminalEnvironment>) -> ConnectionSession {
    let actor = HostActor::spawn(HostConfiguration {
        host_id: HostId(Uuid::from_u128(3)),
        epoch: Uuid::from_u128(4),
        build: build(),
        capabilities: vec!["semantic_state".into()],
        command_cache_capacity: 32,
        terminal_environment: environment,
        machine_environment: None,
    });
    let mut session = ConnectionSession::new(actor);
    assert!(matches!(
        session
            .receive(ClientControl::Hello {
                protocol_version: PROTOCOL_VERSION,
                build: build(),
                role: ClientRole::Ui,
                client_id: Some(ClientId(Uuid::from_u128(5))),
                capabilities: vec!["semantic_state".into()],
                limits: Limits::default(),
            })
            .await,
        HostControl::Welcome { .. }
    ));
    session
}

async fn request(session: &mut ConnectionSession, method: &str, params: Value) -> Value {
    match session
        .receive(ClientControl::Request {
            command_id: CommandId(Uuid::new_v4()),
            method: method.into(),
            params,
        })
        .await
    {
        HostControl::Result { result, .. } => result,
        response => panic!("request failed: {response:?}"),
    }
}

fn spec(argv: Vec<String>) -> SpawnSpec {
    SpawnSpec {
        argv,
        cwd: None,
        environment: Vec::new(),
        rows: 24,
        columns: 80,
        pixel_width: 800,
        pixel_height: 480,
    }
}

async fn create(
    session: &mut ConnectionSession,
    pane_id: PaneId,
    tab_id: TabId,
    spec: SpawnSpec,
) -> ApplyResult {
    let command = Command::CreateTab {
        window_id: WindowId(Uuid::from_u128(2)),
        space_id: SpaceId(Uuid::from_u128(1)),
        tab_id,
        pane_id,
        placement: Placement::Root(RootPlacement {
            pinned: false,
            index: 0,
        }),
        title: None,
        restart_directory: None,
    };
    serde_json::from_value(
        request(
            session,
            "workspace.apply",
            json!({
                "command": command,
                "expected_structure_revision": 0,
                "spawn_specs": BTreeMap::from([(pane_id, spec)])
            }),
        )
        .await,
    )
    .unwrap()
}

async fn snapshot(session: &mut ConnectionSession) -> ModelSnapshot {
    serde_json::from_value(request(session, "state.snapshot", Value::Null).await).unwrap()
}

#[tokio::test]
async fn graph_create_reports_runtime_facts_and_close_reaps_the_tombstone() {
    let directory = tempdir().unwrap();
    let environment_file = directory.path().join("environment");
    let socket_path = directory.path().join("host.sock");
    let cli_path = directory.path().join("sp");
    let state_home = directory.path().join("state");
    let mut session = session(Some(TerminalEnvironment {
        socket_path: socket_path.clone(),
        cli_path: cli_path.clone(),
        state_home: Some(state_home.clone()),
    }))
    .await;
    let pane_id = PaneId(Uuid::from_u128(10));
    let tab_id = TabId(Uuid::from_u128(11));
    let script = format!(
        "printf '%s\\n%s\\n%s\\n%s\\n' \"$SUPATERM_HOST_SOCKET_PATH\" \"$SUPATERM_CLI_PATH\" \"$SUPATERM_PANE_ID\" \"$SUPATERM_STATE_HOME\" > '{}'; printf '\\033]2;Build\\007\\033]7;file:///tmp/work\\007\\033]9;4;1;42\\007'; while :; do sleep 1; done",
        environment_file.display()
    );

    let applied = create(
        &mut session,
        pane_id,
        tab_id,
        spec(vec!["/bin/sh".into(), "-c".into(), script]),
    )
    .await;

    assert_eq!(applied.starting_pane_ids, [pane_id]);
    let running = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snapshot = snapshot(&mut session).await;
            let facts = &snapshot.pane_facts[&pane_id];
            if facts.lifecycle == PaneLifecycle::Running
                && facts.title.as_deref() == Some("Build")
                && facts.current_directory.as_deref() == Some(std::path::Path::new("/tmp/work"))
                && facts.progress.as_ref().is_some_and(|progress| {
                    progress.state == ProgressState::Set && progress.percent == Some(42)
                })
            {
                break snapshot;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(
        running
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id)
    );
    assert_eq!(
        std::fs::read_to_string(environment_file).unwrap(),
        format!(
            "{}\n{}\n{}\n{}\n",
            socket_path.display(),
            cli_path.display(),
            pane_id,
            state_home.display()
        )
    );

    let unconfirmed = session
        .receive(ClientControl::Request {
            command_id: CommandId(Uuid::new_v4()),
            method: "terminal.close".into(),
            params: json!({"pane_id": pane_id}),
        })
        .await;
    assert!(matches!(
        unconfirmed,
        HostControl::Error {
            error: supaterm_host::protocol::control::ProtocolError {
                code: ProtocolErrorCode::ConfirmationRequired,
                ..
            },
            ..
        }
    ));
    assert!(
        snapshot(&mut session)
            .await
            .pane_facts
            .contains_key(&pane_id)
    );

    let confirmation = request(
        &mut session,
        "workspace.prepare_close",
        json!({"command": Command::ClosePane { pane_id }}),
    )
    .await;
    let confirmation_token = confirmation["tokens"][pane_id.to_string()].clone();
    request(
        &mut session,
        "terminal.close",
        json!({"pane_id": pane_id, "confirmation_token": confirmation_token}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snapshot = snapshot(&mut session).await;
            if !snapshot.pane_facts.contains_key(&pane_id)
                && !snapshot
                    .workspace
                    .pane_ids()
                    .any(|candidate| candidate == pane_id)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn host_settings_configure_new_terminal_processes() {
    let directory = tempdir().unwrap();
    let output = directory.path().join("configured");
    let mut session = session(None).await;
    request(
        &mut session,
        "settings.set",
        json!({"key": "terminal.environment", "value": {"HOST_CONFIG": "set"}}),
    )
    .await;
    request(
        &mut session,
        "settings.set",
        json!({
            "key": "terminal.shell",
            "value": [
                "/bin/sh",
                "-c",
                format!(
                    r#"printf "$HOST_CONFIG" > '{}'; while :; do sleep 1; done"#,
                    output.display()
                )
            ]
        }),
    )
    .await;
    let pane_id = PaneId(Uuid::from_u128(12));
    create(
        &mut session,
        pane_id,
        TabId(Uuid::from_u128(13)),
        spec(Vec::new()),
    )
    .await;

    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if std::fs::read_to_string(&output).is_ok_and(|value| value == "set") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    let confirmation = request(
        &mut session,
        "workspace.prepare_close",
        json!({"command": Command::ClosePane { pane_id }}),
    )
    .await;
    request(
        &mut session,
        "terminal.close",
        json!({
            "pane_id": pane_id,
            "confirmation_token": confirmation["tokens"][pane_id.to_string()]
        }),
    )
    .await;
}

#[tokio::test]
async fn spawn_failure_stays_visible_without_a_hidden_runtime() {
    let mut session = session(None).await;
    let pane_id = PaneId(Uuid::from_u128(20));

    create(
        &mut session,
        pane_id,
        TabId(Uuid::from_u128(21)),
        spec(vec!["/path/that/does/not/exist".into()]),
    )
    .await;

    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snapshot = snapshot(&mut session).await;
            if snapshot.pane_facts[&pane_id].lifecycle == PaneLifecycle::Failed {
                assert!(
                    snapshot
                        .workspace
                        .pane_ids()
                        .any(|candidate| candidate == pane_id)
                );
                assert!(snapshot.pane_facts[&pane_id].failure.is_some());
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let terminals = request(&mut session, "terminal.list", Value::Null).await;
    assert_eq!(terminals, json!([]));
}

#[tokio::test]
async fn unexpected_child_exit_removes_its_graph_pane() {
    let mut session = session(None).await;
    let pane_id = PaneId(Uuid::from_u128(30));

    create(
        &mut session,
        pane_id,
        TabId(Uuid::from_u128(31)),
        spec(vec!["/bin/sh".into(), "-c".into(), "exit 7".into()]),
    )
    .await;

    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snapshot = snapshot(&mut session).await;
            if !snapshot.pane_facts.contains_key(&pane_id)
                && !snapshot
                    .workspace
                    .pane_ids()
                    .any(|candidate| candidate == pane_id)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn moving_the_final_root_removes_its_window_without_restarting_the_terminal() {
    let mut session = session(None).await;
    let pane_id = PaneId(Uuid::from_u128(40));
    let tab_id = TabId(Uuid::from_u128(41));
    create(
        &mut session,
        pane_id,
        tab_id,
        spec(vec![
            "/bin/sh".into(),
            "-c".into(),
            "while :; do sleep 1; done".into(),
        ]),
    )
    .await;
    let pid = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let panes: Vec<PaneInfo> =
                serde_json::from_value(request(&mut session, "terminal.list", Value::Null).await)
                    .unwrap();
            if let Some(pane) = panes.into_iter().find(|pane| pane.id == pane_id) {
                break pane.pid;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let destination_window_id = WindowId(Uuid::from_u128(42));
    let before = snapshot(&mut session).await;
    request(
        &mut session,
        "workspace.apply",
        json!({
            "command": Command::AddWindow { window_id: destination_window_id },
            "expected_structure_revision": before.structure_revision
        }),
    )
    .await;
    let before_move = snapshot(&mut session).await;
    request(
        &mut session,
        "workspace.apply",
        json!({
            "command": Command::MoveItems {
                source_window_id: WindowId(Uuid::from_u128(2)),
                source_space_id: SpaceId(Uuid::from_u128(1)),
                item_ids: vec![ItemId::Tab(tab_id)],
                destination_window_id,
                destination_space_id: SpaceId(Uuid::from_u128(1)),
                destination: Placement::Root(RootPlacement { pinned: false, index: 0 }),
            },
            "expected_structure_revision": before_move.structure_revision
        }),
    )
    .await;

    let moved = snapshot(&mut session).await;
    assert!(
        !moved
            .workspace
            .windows
            .contains_key(&WindowId(Uuid::from_u128(2)))
    );
    assert!(
        moved
            .workspace
            .pane_ids()
            .any(|candidate| candidate == pane_id)
    );
    let panes: Vec<PaneInfo> =
        serde_json::from_value(request(&mut session, "terminal.list", Value::Null).await).unwrap();
    assert_eq!(panes[0].pid, pid);

    let confirmation = request(
        &mut session,
        "workspace.prepare_close",
        json!({"command": Command::ClosePane { pane_id }}),
    )
    .await;
    request(
        &mut session,
        "terminal.close",
        json!({
            "pane_id": pane_id,
            "confirmation_token": confirmation["tokens"][pane_id.to_string()]
        }),
    )
    .await;
}

#[tokio::test]
async fn terminate_all_reaps_processes_and_resets_the_workspace() {
    let mut session = session(None).await;
    let pane_id = PaneId(Uuid::from_u128(70));
    create(
        &mut session,
        pane_id,
        TabId(Uuid::from_u128(71)),
        spec(vec![
            "/bin/sh".into(),
            "-c".into(),
            "while :; do sleep 1; done".into(),
        ]),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let panes: Vec<PaneInfo> =
                serde_json::from_value(request(&mut session, "terminal.list", Value::Null).await)
                    .unwrap();
            if panes.iter().any(|pane| pane.id == pane_id) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let response = request(
        &mut session,
        "host.terminate_all",
        json!({"confirmed": true}),
    )
    .await;
    assert_eq!(response["terminated_pane_count"], 1);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let panes: Vec<PaneInfo> =
                serde_json::from_value(request(&mut session, "terminal.list", Value::Null).await)
                    .unwrap();
            if panes.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let state = snapshot(&mut session).await;
    assert_eq!(state.workspace.windows.len(), 1);
    assert_eq!(state.workspace.spaces.len(), 1);
    assert_eq!(state.workspace.pane_ids().count(), 0);
}

#[tokio::test]
async fn one_notification_sink_delivers_once_and_a_late_sink_skips_history() {
    let mut first = session(None).await;
    let actor = first.actor().clone();
    let lease = request(&mut first, "notification.claim_sink", Value::Null).await;
    let lease_id = lease["lease_id"].clone();
    let pane_id = PaneId(Uuid::from_u128(50));
    create(
        &mut first,
        pane_id,
        TabId(Uuid::from_u128(51)),
        spec(vec![
            "/bin/sh".into(),
            "-c".into(),
            "printf '\\a'; sleep 1".into(),
        ]),
    )
    .await;
    let notification = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let value = request(
                &mut first,
                "notification.next",
                json!({"lease_id": lease_id}),
            )
            .await;
            if !value.is_null() {
                break value;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(notification["pane_id"], pane_id.to_string());
    request(
        &mut first,
        "notification.ack",
        json!({
            "lease_id": lease_id,
            "notification_id": notification["id"]
        }),
    )
    .await;

    let mut second = ConnectionSession::new(actor);
    second
        .receive(ClientControl::Hello {
            protocol_version: PROTOCOL_VERSION,
            build: build(),
            role: ClientRole::Ui,
            client_id: Some(ClientId(Uuid::from_u128(52))),
            capabilities: vec!["semantic_state".into()],
            limits: Limits::default(),
        })
        .await;
    let refused = second
        .receive(ClientControl::Request {
            command_id: CommandId(Uuid::new_v4()),
            method: "notification.claim_sink".into(),
            params: Value::Null,
        })
        .await;
    assert!(matches!(
        refused,
        HostControl::Error {
            error: supaterm_host::protocol::control::ProtocolError {
                code: ProtocolErrorCode::CapabilityUnavailable,
                ..
            },
            ..
        }
    ));
    drop(first);
    let late_lease = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let response = second
                .receive(ClientControl::Request {
                    command_id: CommandId(Uuid::new_v4()),
                    method: "notification.claim_sink".into(),
                    params: Value::Null,
                })
                .await;
            if let HostControl::Result { result, .. } = response {
                break result;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        request(
            &mut second,
            "notification.next",
            json!({"lease_id": late_lease["lease_id"]}),
        )
        .await
        .is_null()
    );
}
