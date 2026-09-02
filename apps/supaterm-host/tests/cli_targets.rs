use std::collections::BTreeSet;
use supaterm_host::host::cli::{CliTarget, CliTargetError, CliTargetKind, CliTargetResolver};
use supaterm_host::protocol::control::ClientId;
use supaterm_host::protocol::terminal::PaneId;
use supaterm_host::workspace::model::{
    ClientState, Placement, RootPlacement, SpaceId, TabId, WindowId, Workspace,
};
use supaterm_host::workspace::reducer::{Command, apply};
use uuid::Uuid;

fn fixture() -> (
    Workspace,
    Vec<ClientState>,
    ClientId,
    PaneId,
    TabId,
    SpaceId,
    WindowId,
) {
    let space_id = SpaceId(Uuid::from_u128(0x11111111_1111_4111_8111_111111111111));
    let window_id = WindowId(Uuid::from_u128(0x22222222_2222_4222_8222_222222222222));
    let client_id = ClientId(Uuid::from_u128(0x33333333_3333_4333_8333_333333333333));
    let pane_id = PaneId(Uuid::from_u128(0x44444444_4444_4444_8444_444444444444));
    let tab_id = TabId(Uuid::from_u128(0x55555555_5555_4555_8555_555555555555));
    let mut workspace = Workspace::new(space_id, window_id, "Main".into());
    let mut clients = vec![ClientState::new(client_id, window_id, space_id)];
    apply(
        &mut workspace,
        &mut clients,
        Command::CreateTab {
            window_id,
            space_id,
            tab_id,
            pane_id,
            placement: Placement::Root(RootPlacement {
                pinned: false,
                index: 0,
            }),
            title: None,
            restart_directory: None,
        },
    )
    .unwrap();
    (
        workspace, clients, client_id, pane_id, tab_id, space_id, window_id,
    )
}

#[test]
fn pane_context_resolves_every_ambient_ancestor() {
    let (workspace, clients, _, pane_id, tab_id, space_id, window_id) = fixture();
    let active = BTreeSet::new();
    let resolver = CliTargetResolver::new(&workspace, &clients, &active, Some(pane_id));
    let target = CliTarget::Ambient;

    assert_eq!(
        resolver
            .resolve(CliTargetKind::Window, &target)
            .unwrap()
            .window_id,
        window_id
    );
    assert_eq!(
        resolver
            .resolve(CliTargetKind::Space, &target)
            .unwrap()
            .space_id,
        space_id
    );
    assert_eq!(
        resolver
            .resolve(CliTargetKind::Tab, &target)
            .unwrap()
            .tab_id,
        Some(tab_id)
    );
    assert_eq!(
        resolver
            .resolve(CliTargetKind::Pane, &target)
            .unwrap()
            .pane_id,
        Some(pane_id)
    );
}

#[test]
fn active_ui_is_required_and_two_active_windows_are_ambiguous() {
    let (mut workspace, mut clients, first_client_id, _, _, space_id, _) = fixture();
    let no_active = BTreeSet::new();
    assert_eq!(
        CliTargetResolver::new(&workspace, &clients, &no_active, None)
            .resolve(CliTargetKind::Window, &CliTarget::Ambient),
        Err(CliTargetError::NoAmbientTarget)
    );
    let second_window_id = WindowId(Uuid::from_u128(0x66666666_6666_4666_8666_666666666666));
    apply(
        &mut workspace,
        &mut clients,
        Command::AddWindow {
            window_id: second_window_id,
        },
    )
    .unwrap();
    let second_client_id = ClientId(Uuid::from_u128(0x77777777_7777_4777_8777_777777777777));
    let mut second = ClientState::for_workspace(second_client_id, &workspace);
    second.active_window_id = Some(second_window_id);
    clients.push(second);
    let active = BTreeSet::from([first_client_id, second_client_id]);
    assert_eq!(
        CliTargetResolver::new(&workspace, &clients, &active, None)
            .resolve(CliTargetKind::Window, &CliTarget::Ambient),
        Err(CliTargetError::AmbiguousAmbientTarget)
    );
    assert!(workspace.content(second_window_id, space_id).is_some());
}

#[test]
fn paths_full_ids_and_typed_short_refs_resolve_on_the_host() {
    let (workspace, clients, client_id, pane_id, tab_id, _, _) = fixture();
    let active = BTreeSet::from([client_id]);
    let resolver = CliTargetResolver::new(&workspace, &clients, &active, None);

    assert_eq!(
        resolver
            .resolve(
                CliTargetKind::Pane,
                &CliTarget::Path {
                    indexes: vec![1, 1, 1]
                }
            )
            .unwrap()
            .pane_id,
        Some(pane_id)
    );
    assert_eq!(
        resolver
            .resolve(CliTargetKind::Tab, &CliTarget::Id { id: tab_id.0 })
            .unwrap()
            .tab_id,
        Some(tab_id)
    );
    assert_eq!(
        resolver
            .resolve(
                CliTargetKind::Pane,
                &CliTarget::Short {
                    kind: CliTargetKind::Pane,
                    prefix: "44444444".into()
                }
            )
            .unwrap()
            .pane_id,
        Some(pane_id)
    );
}

#[test]
fn explicit_space_resolves_in_a_single_headless_window() {
    let (workspace, clients, _, _, _, space_id, window_id) = fixture();
    let active = BTreeSet::new();
    let resolver = CliTargetResolver::new(&workspace, &clients, &active, None);

    assert_eq!(
        resolver
            .resolve(CliTargetKind::Space, &CliTarget::Id { id: space_id.0 })
            .unwrap()
            .window_id,
        window_id
    );
}
