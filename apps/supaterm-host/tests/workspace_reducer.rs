use proptest::prelude::*;
use std::collections::BTreeSet;
use supaterm_host::protocol::control::ClientId;
use supaterm_host::protocol::terminal::PaneId;
use supaterm_host::workspace::model::{
    ClientState, GroupId, ItemId, Placement, RootPlacement, SpaceId, SplitDirection, SplitId,
    SplitNode, SplitPlacement, TabId, WindowId, Workspace,
};
use supaterm_host::workspace::reducer::{Command, ReducerError, apply};
use uuid::Uuid;

fn ids() -> (SpaceId, WindowId, ClientId) {
    (
        SpaceId(Uuid::from_u128(1)),
        WindowId(Uuid::from_u128(2)),
        ClientId(Uuid::from_u128(3)),
    )
}

fn state() -> (Workspace, ClientState) {
    let (space_id, window_id, client_id) = ids();
    (
        Workspace::new(space_id, window_id, "Space 1".into()),
        ClientState::new(client_id, window_id, space_id),
    )
}

fn create_tab(workspace: &mut Workspace, clients: &mut [ClientState], tab: u128, pane: u128) {
    let (space_id, window_id, _) = ids();
    apply(
        workspace,
        clients,
        Command::CreateTab {
            window_id,
            space_id,
            tab_id: TabId(Uuid::from_u128(tab)),
            pane_id: PaneId(Uuid::from_u128(pane)),
            placement: Placement::Root(RootPlacement {
                pinned: false,
                index: workspace
                    .content(window_id, space_id)
                    .unwrap()
                    .regular_roots
                    .len(),
            }),
            title: None,
            restart_directory: None,
        },
    )
    .unwrap();
}

#[test]
fn tabs_groups_moves_and_selection_repair_match_flattened_order() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, client_id) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    create_tab(&mut workspace, &mut clients, 11, 21);
    create_tab(&mut workspace, &mut clients, 12, 22);
    let first = TabId(Uuid::from_u128(10));
    let second = TabId(Uuid::from_u128(11));
    let third = TabId(Uuid::from_u128(12));
    let group_id = GroupId(Uuid::from_u128(30));
    apply(
        &mut workspace,
        &mut clients,
        Command::CreateGroup {
            window_id,
            space_id,
            group_id,
            title: "Build".into(),
            color: "blue".into(),
            tab_ids: vec![first, second],
        },
    )
    .unwrap();
    assert_eq!(
        workspace.content(window_id, space_id).unwrap().flat_tabs(),
        vec![first, second, third]
    );
    apply(
        &mut workspace,
        &mut clients,
        Command::SelectTab {
            client_id,
            window_id,
            space_id,
            tab_id: second,
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::CloseTab {
            window_id,
            space_id,
            tab_id: second,
        },
    )
    .unwrap();
    assert_eq!(clients[0].selected_tab(window_id, space_id), Some(third));
    apply(
        &mut workspace,
        &mut clients,
        Command::MoveItems {
            source_window_id: window_id,
            source_space_id: space_id,
            item_ids: vec![ItemId::Tab(first)],
            destination_window_id: window_id,
            destination_space_id: space_id,
            destination: Placement::Root(RootPlacement {
                pinned: true,
                index: 0,
            }),
        },
    )
    .unwrap();
    let content = workspace.content(window_id, space_id).unwrap();
    assert_eq!(content.pinned_roots, vec![ItemId::Tab(first)]);
    assert!(!content.groups.contains_key(&group_id));
    workspace.validate(&clients).unwrap();
}

#[test]
fn split_close_and_ratio_use_stable_split_ids() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, client_id) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    let tab_id = TabId(Uuid::from_u128(10));
    let first_pane = PaneId(Uuid::from_u128(20));
    let second_pane = PaneId(Uuid::from_u128(21));
    let split_id = SplitId(Uuid::from_u128(40));
    apply(
        &mut workspace,
        &mut clients,
        Command::SplitPane {
            window_id,
            space_id,
            tab_id,
            target_pane_id: first_pane,
            pane_id: second_pane,
            split_id,
            direction: SplitDirection::Horizontal,
            placement: SplitPlacement::After,
            restart_directory: None,
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::FocusPane {
            client_id,
            window_id,
            space_id,
            tab_id,
            pane_id: second_pane,
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::SetSplitRatio {
            split_id,
            ratio: 0.3,
        },
    )
    .unwrap();
    assert_eq!(workspace.split(split_id).unwrap().ratio(), Some(0.3));
    let result = apply(
        &mut workspace,
        &mut clients,
        Command::ClosePane {
            pane_id: second_pane,
        },
    )
    .unwrap();
    assert_eq!(result.focus_pane_id, Some(first_pane));
    assert_eq!(
        workspace.tab(tab_id).unwrap().root.leaves(),
        vec![first_pane]
    );
    assert_eq!(
        clients[0].windows[&window_id].spaces[&space_id].focused_panes[&tab_id],
        first_pane
    );
    workspace.validate(&clients).unwrap();
}

#[test]
fn layouts_preserve_leaf_order_and_replace_split_ids() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, _) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    let tab_id = TabId(Uuid::from_u128(10));
    for offset in 1..5 {
        apply(
            &mut workspace,
            &mut clients,
            Command::SplitPane {
                window_id,
                space_id,
                tab_id,
                target_pane_id: PaneId(Uuid::from_u128(20 + offset - 1)),
                pane_id: PaneId(Uuid::from_u128(20 + offset)),
                split_id: SplitId(Uuid::from_u128(40 + offset)),
                direction: SplitDirection::Horizontal,
                placement: SplitPlacement::After,
                restart_directory: None,
            },
        )
        .unwrap();
    }
    let leaves = workspace.tab(tab_id).unwrap().root.leaves();
    apply(
        &mut workspace,
        &mut clients,
        Command::TileTab {
            window_id,
            space_id,
            tab_id,
            split_ids: (50..54).map(|id| SplitId(Uuid::from_u128(id))).collect(),
        },
    )
    .unwrap();
    let root = &workspace.tab(tab_id).unwrap().root;
    assert_eq!(root.leaves(), leaves);
    assert!(matches!(
        root,
        SplitNode::Split {
            direction: SplitDirection::Vertical,
            ..
        }
    ));
    apply(
        &mut workspace,
        &mut clients,
        Command::MainVerticalTab {
            window_id,
            space_id,
            tab_id,
            split_ids: (60..64).map(|id| SplitId(Uuid::from_u128(id))).collect(),
        },
    )
    .unwrap();
    let root = &workspace.tab(tab_id).unwrap().root;
    assert_eq!(root.leaves(), leaves);
    assert!(matches!(
        root,
        SplitNode::Split {
            direction: SplitDirection::Horizontal,
            second,
            ..
        } if matches!(
            second.as_ref(),
            SplitNode::Split {
                direction: SplitDirection::Vertical,
                ..
            }
        )
    ));
}

#[test]
fn same_group_reorder_adjusts_the_post_extraction_index() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, _) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    create_tab(&mut workspace, &mut clients, 11, 21);
    let first = TabId(Uuid::from_u128(10));
    let second = TabId(Uuid::from_u128(11));
    let group_id = GroupId(Uuid::from_u128(30));
    apply(
        &mut workspace,
        &mut clients,
        Command::CreateGroup {
            window_id,
            space_id,
            group_id,
            title: "Build".into(),
            color: "blue".into(),
            tab_ids: vec![first, second],
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::MoveItems {
            source_window_id: window_id,
            source_space_id: space_id,
            item_ids: vec![ItemId::Tab(first)],
            destination_window_id: window_id,
            destination_space_id: space_id,
            destination: Placement::Group { group_id, index: 2 },
        },
    )
    .unwrap();
    assert_eq!(
        workspace.content(window_id, space_id).unwrap().groups[&group_id].tabs,
        vec![second, first]
    );
}

#[test]
fn detach_and_merge_preserve_pinning_and_remove_the_empty_window() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, _) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    let tab_id = TabId(Uuid::from_u128(10));
    apply(
        &mut workspace,
        &mut clients,
        Command::MoveItems {
            source_window_id: window_id,
            source_space_id: space_id,
            item_ids: vec![ItemId::Tab(tab_id)],
            destination_window_id: window_id,
            destination_space_id: space_id,
            destination: Placement::Root(RootPlacement {
                pinned: true,
                index: 0,
            }),
        },
    )
    .unwrap();
    let detached_window_id = WindowId(Uuid::from_u128(70));
    apply(
        &mut workspace,
        &mut clients,
        Command::DetachToWindow {
            source_window_id: window_id,
            source_space_id: space_id,
            item_ids: vec![ItemId::Tab(tab_id)],
            window_id: detached_window_id,
        },
    )
    .unwrap();
    assert_eq!(
        workspace
            .content(detached_window_id, space_id)
            .unwrap()
            .pinned_roots,
        vec![ItemId::Tab(tab_id)]
    );
    apply(
        &mut workspace,
        &mut clients,
        Command::MergeWindow {
            source_window_id: detached_window_id,
            destination_window_id: window_id,
        },
    )
    .unwrap();
    assert!(!workspace.windows.contains_key(&detached_window_id));
    assert_eq!(
        workspace.content(window_id, space_id).unwrap().pinned_roots,
        vec![ItemId::Tab(tab_id)]
    );
    workspace.validate(&clients).unwrap();
}

#[test]
fn deleting_a_displayed_space_selects_its_next_neighbor_in_every_window() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (first_space_id, window_id, client_id) = ids();
    let second_space_id = SpaceId(Uuid::from_u128(80));
    apply(
        &mut workspace,
        &mut clients,
        Command::AddSpace {
            space_id: second_space_id,
            name: "Second".into(),
            color: "red".into(),
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::SelectSpace {
            client_id,
            window_id,
            space_id: first_space_id,
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::DeleteSpace {
            space_id: first_space_id,
        },
    )
    .unwrap();
    assert_eq!(
        clients[0].windows[&window_id].displayed_space_id,
        second_space_id
    );
    assert_eq!(workspace.spaces[0].id, second_space_id);
}

#[test]
fn rejected_commands_leave_workspace_and_clients_unchanged() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let before_workspace = workspace.clone();
    let before_clients = clients.clone();
    let (space_id, window_id, _) = ids();
    let result = apply(
        &mut workspace,
        &mut clients,
        Command::CreateTab {
            window_id,
            space_id,
            tab_id: TabId(Uuid::from_u128(10)),
            pane_id: PaneId(Uuid::from_u128(20)),
            placement: Placement::Root(RootPlacement {
                pinned: false,
                index: 9,
            }),
            title: None,
            restart_directory: None,
        },
    );
    assert!(matches!(result, Err(ReducerError::InvalidPlacement)));
    assert_eq!(workspace, before_workspace);
    assert_eq!(clients, before_clients);
}

proptest! {
    #[test]
    fn generated_create_move_close_sequences_preserve_invariants(operations in prop::collection::vec(0_u8..4, 1..100)) {
        let (mut workspace, client) = state();
        let mut clients = vec![client];
        let (space_id, window_id, _) = ids();
        let mut live = Vec::new();
        let mut next = 100_u128;
        for operation in operations {
            match operation {
                0 | 1 => {
                    let tab_id = TabId(Uuid::from_u128(next));
                    let pane_id = PaneId(Uuid::from_u128(next + 10_000));
                    next += 1;
                    let index = workspace.content(window_id, space_id).unwrap().regular_roots.len();
                    let _ = apply(&mut workspace, &mut clients, Command::CreateTab {
                        window_id,
                        space_id,
                        tab_id,
                        pane_id,
                        placement: Placement::Root(RootPlacement { pinned: false, index }),
                        title: None,
                        restart_directory: None,
                    });
                    live.push(tab_id);
                }
                2 if !live.is_empty() => {
                    let tab_id = live.remove(0);
                    let _ = apply(&mut workspace, &mut clients, Command::CloseTab { window_id, space_id, tab_id });
                }
                3 if live.len() > 1 => {
                    let tab_id = *live.last().unwrap();
                    let _ = apply(&mut workspace, &mut clients, Command::MoveItems {
                        source_window_id: window_id,
                        source_space_id: space_id,
                        item_ids: vec![ItemId::Tab(tab_id)],
                        destination_window_id: window_id,
                        destination_space_id: space_id,
                        destination: Placement::Root(RootPlacement { pinned: true, index: 0 }),
                    });
                }
                _ => {}
            }
            prop_assert!(workspace.validate(&clients).is_ok());
            let panes: Vec<_> = workspace.pane_ids().collect();
            prop_assert_eq!(panes.len(), panes.iter().copied().collect::<BTreeSet<_>>().len());
        }
    }
}
