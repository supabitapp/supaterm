use proptest::prelude::*;
use std::collections::BTreeSet;
use supaterm_host::protocol::control::ClientId;
use supaterm_host::protocol::terminal::PaneId;
use supaterm_host::workspace::model::{
    ClientState, GroupId, ItemId, Placement, PlatformWindowPlacement, RootPlacement, SpaceId,
    SplitDirection, SplitId, SplitNode, SplitPlacement, TabId, WindowId, Workspace,
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
fn space_and_group_colors_change_without_replacing_identity() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, _) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    let tab_id = TabId(Uuid::from_u128(10));
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
            tab_ids: vec![tab_id],
        },
    )
    .unwrap();

    apply(
        &mut workspace,
        &mut clients,
        Command::SetSpaceColor {
            space_id,
            color: "red".into(),
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::SetGroupColor {
            group_id,
            color: "green".into(),
        },
    )
    .unwrap();

    assert_eq!(workspace.spaces[0].color, "red");
    assert_eq!(
        workspace.content(window_id, space_id).unwrap().groups[&group_id].color,
        "green"
    );
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
        clients[0].windows[&window_id].focused_pane_by_tab[&tab_id],
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
    create_tab(&mut workspace, &mut clients, 11, 21);
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
fn client_presentation_is_complete_independent_and_tracks_navigation_history() {
    let (mut workspace, first) = state();
    let (first_space_id, first_window_id, first_client_id) = ids();
    let second_client_id = ClientId(Uuid::from_u128(4));
    let second_space_id = SpaceId(Uuid::from_u128(80));
    let second_window_id = WindowId(Uuid::from_u128(81));
    let mut clients = vec![
        first,
        ClientState::for_workspace(second_client_id, &workspace),
    ];
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
        Command::AddWindow {
            window_id: second_window_id,
        },
    )
    .unwrap();
    create_tab(&mut workspace, &mut clients, 10, 20);
    create_tab(&mut workspace, &mut clients, 11, 21);
    let first_tab_id = TabId(Uuid::from_u128(10));
    let second_tab_id = TabId(Uuid::from_u128(11));
    let first_pane_id = PaneId(Uuid::from_u128(20));
    let second_pane_id = PaneId(Uuid::from_u128(22));
    apply(
        &mut workspace,
        &mut clients,
        Command::SplitPane {
            window_id: first_window_id,
            space_id: first_space_id,
            tab_id: first_tab_id,
            target_pane_id: first_pane_id,
            pane_id: second_pane_id,
            split_id: SplitId(Uuid::from_u128(23)),
            direction: SplitDirection::Horizontal,
            placement: SplitPlacement::After,
            restart_directory: None,
        },
    )
    .unwrap();

    for command in [
        Command::SelectTab {
            client_id: first_client_id,
            window_id: first_window_id,
            space_id: first_space_id,
            tab_id: first_tab_id,
        },
        Command::SelectTab {
            client_id: first_client_id,
            window_id: first_window_id,
            space_id: first_space_id,
            tab_id: second_tab_id,
        },
        Command::FocusPane {
            client_id: first_client_id,
            window_id: first_window_id,
            space_id: first_space_id,
            tab_id: first_tab_id,
            pane_id: first_pane_id,
        },
        Command::FocusPane {
            client_id: first_client_id,
            window_id: first_window_id,
            space_id: first_space_id,
            tab_id: first_tab_id,
            pane_id: second_pane_id,
        },
        Command::SelectSpace {
            client_id: first_client_id,
            window_id: first_window_id,
            space_id: second_space_id,
        },
        Command::SetActiveWindow {
            client_id: first_client_id,
            window_id: Some(second_window_id),
        },
        Command::ReorderWindow {
            client_id: first_client_id,
            window_id: second_window_id,
            index: 0,
        },
        Command::SetWindowOpen {
            client_id: first_client_id,
            window_id: second_window_id,
            is_open: false,
        },
        Command::SetZoomedPane {
            client_id: first_client_id,
            window_id: first_window_id,
            tab_id: first_tab_id,
            pane_id: Some(first_pane_id),
        },
        Command::SetSidebar {
            client_id: first_client_id,
            window_id: first_window_id,
            collapsed: true,
            width: Some(336),
        },
        Command::SetAgentPanelHidden {
            client_id: first_client_id,
            window_id: first_window_id,
            pane_id: first_pane_id,
            hidden: true,
        },
        Command::SetPlatformPlacement {
            client_id: first_client_id,
            window_id: first_window_id,
            placement: Some(PlatformWindowPlacement {
                platform: "macos".into(),
                x: 10,
                y: 20,
                width: 1200,
                height: 800,
                display_id: Some("main".into()),
            }),
        },
    ] {
        apply(&mut workspace, &mut clients, command).unwrap();
    }

    let first = &clients[0];
    let window = &first.windows[&first_window_id];
    assert_eq!(first.active_window_id, Some(first_window_id));
    assert_eq!(first.window_order[0], second_window_id);
    assert!(!first.windows[&second_window_id].is_open);
    assert_eq!(window.previous_space_id, Some(first_space_id));
    assert_eq!(window.selected_tab_by_space[&first_space_id], second_tab_id);
    assert_eq!(window.previous_tab_by_space[&first_space_id], first_tab_id);
    assert_eq!(window.focused_pane_by_tab[&first_tab_id], second_pane_id);
    assert_eq!(window.previous_pane_by_tab[&first_tab_id], first_pane_id);
    assert_eq!(window.zoomed_pane_by_tab[&first_tab_id], first_pane_id);
    assert!(window.sidebar_collapsed);
    assert_eq!(window.sidebar_width, Some(336));
    assert!(window.hidden_agent_panels.contains(&first_pane_id));
    assert_eq!(
        window.platform_placement.as_ref().unwrap().platform,
        "macos"
    );
    assert_eq!(clients[1].active_window_id, Some(first_window_id));
    assert!(clients[1].windows[&second_window_id].is_open);
    workspace.validate(&clients).unwrap();
}

#[test]
fn panes_move_between_tabs_and_into_new_tabs_without_changing_identity() {
    let (mut workspace, client) = state();
    let mut clients = vec![client];
    let (space_id, window_id, client_id) = ids();
    create_tab(&mut workspace, &mut clients, 10, 20);
    create_tab(&mut workspace, &mut clients, 11, 21);
    let source_tab_id = TabId(Uuid::from_u128(10));
    let destination_tab_id = TabId(Uuid::from_u128(11));
    let moved_pane_id = PaneId(Uuid::from_u128(20));
    let destination_pane_id = PaneId(Uuid::from_u128(21));
    apply(
        &mut workspace,
        &mut clients,
        Command::SetAgentPanelHidden {
            client_id,
            window_id,
            pane_id: moved_pane_id,
            hidden: true,
        },
    )
    .unwrap();
    apply(
        &mut workspace,
        &mut clients,
        Command::MovePaneToTab {
            pane_id: moved_pane_id,
            destination_tab_id,
            target_pane_id: destination_pane_id,
            split_id: SplitId(Uuid::from_u128(30)),
            direction: SplitDirection::Vertical,
            placement: SplitPlacement::Before,
        },
    )
    .unwrap();
    assert!(workspace.tab(source_tab_id).is_none());
    assert_eq!(
        workspace.tab(destination_tab_id).unwrap().root.leaves(),
        vec![moved_pane_id, destination_pane_id]
    );
    assert!(
        clients[0].windows[&window_id]
            .hidden_agent_panels
            .contains(&moved_pane_id)
    );

    let new_tab_id = TabId(Uuid::from_u128(12));
    apply(
        &mut workspace,
        &mut clients,
        Command::MovePaneToNewTab {
            pane_id: moved_pane_id,
            tab_id: new_tab_id,
            destination_window_id: window_id,
            destination_space_id: space_id,
            destination: Placement::Root(RootPlacement {
                pinned: true,
                index: 0,
            }),
            title: Some("Moved".into()),
        },
    )
    .unwrap();
    assert_eq!(
        workspace.tab(new_tab_id).unwrap().root.leaves(),
        vec![moved_pane_id]
    );
    assert_eq!(
        workspace.tab(new_tab_id).unwrap().title.as_deref(),
        Some("Moved")
    );
    assert_eq!(
        workspace.content(window_id, space_id).unwrap().pinned_roots,
        vec![ItemId::Tab(new_tab_id)]
    );
    assert!(
        clients[0].windows[&window_id]
            .hidden_agent_panels
            .contains(&moved_pane_id)
    );
    workspace.validate(&clients).unwrap();
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
