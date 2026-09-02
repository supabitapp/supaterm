use supaterm_host::protocol::control::ClientId;
use supaterm_host::workspace::model::{ClientState, SpaceId, WindowId, Workspace};
use supaterm_host::workspace::reducer::Command;
use supaterm_host::workspace::replay::{HostModel, ModelError, Subscription};
use uuid::Uuid;

fn model() -> (HostModel, ClientId, ClientId, SpaceId) {
    let space_id = SpaceId(Uuid::from_u128(1));
    let window_id = WindowId(Uuid::from_u128(2));
    let first = ClientId(Uuid::from_u128(3));
    let second = ClientId(Uuid::from_u128(4));
    let workspace = Workspace::new(space_id, window_id, "Space 1".into());
    let clients = vec![
        ClientState::new(first, window_id, space_id),
        ClientState::new(second, window_id, space_id),
    ];
    (
        HostModel::new(workspace, clients, 2, 8 * 1024),
        first,
        second,
        space_id,
    )
}

#[test]
fn revisions_are_atomic_private_gaps_are_valid_and_old_cursors_resync() {
    let (mut model, first, second, space_id) = model();
    let window_id = WindowId(Uuid::from_u128(2));
    model
        .apply(
            Command::SelectSpace {
                client_id: first,
                window_id,
                space_id,
            },
            None,
        )
        .unwrap();
    model
        .apply(
            Command::RenameSpace {
                space_id,
                name: "Renamed".into(),
            },
            None,
        )
        .unwrap();
    assert_eq!(model.revision(), 2);
    assert_eq!(model.structure_revision(), 0);
    match model.subscribe(second, Some(0)) {
        Subscription::Replay(events) => {
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].revision, 2);
        }
        subscription => panic!("expected replay, got {subscription:?}"),
    }
    model
        .apply(
            Command::AddSpace {
                space_id: SpaceId(Uuid::from_u128(5)),
                name: "Two".into(),
                color: "neutral".into(),
            },
            Some(0),
        )
        .unwrap();
    assert_eq!(model.structure_revision(), 1);
    assert!(matches!(
        model.apply(
            Command::AddSpace {
                space_id: SpaceId(Uuid::from_u128(6)),
                name: "Three".into(),
                color: "neutral".into(),
            },
            Some(0),
        ),
        Err(ModelError::StaleStructure { actual: 1, .. })
    ));
    assert_eq!(model.revision(), 3);
    model
        .apply(
            Command::RenameSpace {
                space_id,
                name: "Again".into(),
            },
            None,
        )
        .unwrap();
    model
        .apply(
            Command::RenameSpace {
                space_id,
                name: "Final".into(),
            },
            None,
        )
        .unwrap();
    assert!(matches!(
        model.subscribe(first, Some(0)),
        Subscription::Snapshot(_)
    ));
}

#[test]
fn reset_replaces_every_client_projection_in_one_revision() {
    let (mut model, first, second, _) = model();
    let replacement_space = SpaceId(Uuid::from_u128(50));
    let replacement_window = WindowId(Uuid::from_u128(51));
    let before_revision = model.revision();
    let before_structure_revision = model.structure_revision();

    let closing = model.reset_workspace(Workspace::new(
        replacement_space,
        replacement_window,
        "Fresh".into(),
    ));

    assert!(closing.is_empty());
    assert_eq!(model.revision(), before_revision + 1);
    assert_eq!(model.structure_revision(), before_structure_revision + 1);
    assert_eq!(model.clients().len(), 2);
    for client_id in [first, second] {
        let snapshot = model.snapshot(client_id);
        assert_eq!(snapshot.workspace.spaces[0].id, replacement_space);
        assert_eq!(
            snapshot.client_state.unwrap().active_window_id,
            Some(replacement_window)
        );
    }
}
