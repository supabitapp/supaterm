use supaterm_host::protocol::control::{ClientId, HostId};
use supaterm_host::workspace::model::{ClientState, SpaceId, WindowId, Workspace};
use supaterm_host::workspace::persistence::{DurableDocument, PersistenceWorker, load_or_reset};
use tempfile::tempdir;
use uuid::Uuid;

fn document(name: &str) -> DurableDocument {
    let space_id = SpaceId(Uuid::from_u128(1));
    let window_id = WindowId(Uuid::from_u128(2));
    DurableDocument::new(
        HostId(Uuid::from_u128(3)),
        Workspace::new(space_id, window_id, name.into()),
        vec![ClientState::new(
            ClientId(Uuid::from_u128(4)),
            window_id,
            space_id,
        )],
    )
}

#[tokio::test]
async fn coalesced_atomic_save_round_trips_the_latest_exact_schema() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("host-state.json");
    let worker = PersistenceWorker::spawn(path.clone());
    worker.save(document("First")).await.unwrap();
    worker.save(document("Second")).await.unwrap();
    worker.flush().await.unwrap();
    let loaded = load_or_reset(&path).unwrap();
    assert!(!loaded.reset);
    assert_eq!(loaded.document.workspace.spaces[0].name, "Second");
    assert_eq!(loaded.document, document("Second"));
}

#[test]
fn unknown_or_invalid_schema_resets_to_a_clean_valid_workspace() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("host-state.json");
    std::fs::write(
        &path,
        br#"{"schema_version":99,"host_id":"00000000-0000-0000-0000-000000000003","workspace":{},"clients":[],"settings":{}}"#,
    )
    .unwrap();
    let loaded = load_or_reset(&path).unwrap();
    assert!(loaded.reset);
    loaded
        .document
        .workspace
        .validate(&loaded.document.clients)
        .unwrap();
}

#[test]
fn durable_json_contains_no_runtime_terminal_or_process_facts() {
    let value = serde_json::to_value(document("Space 1")).unwrap();
    let text = serde_json::to_string(&value).unwrap();
    for forbidden in [
        "pid",
        "output_sequence",
        "writer",
        "attachment",
        "scrollback",
        "agent_phase",
        "runtime_epoch",
    ] {
        assert!(!text.contains(forbidden));
    }
}
