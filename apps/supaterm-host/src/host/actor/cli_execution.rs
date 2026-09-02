use super::{ActorState, ApplyRequest, ApplyWorkspaceError};
use crate::host::cli::{
    CliAction, CliExecuteRequest, CliNavigation, CliPaneLayout, CliTarget, CliTargetError,
    CliTargetKind, CliTargetResolver, TargetLocation,
};
use crate::protocol::control::{ClientId, ProtocolErrorCode};
use crate::protocol::terminal::PaneId;
use crate::terminal::actor::TerminalError;
use crate::terminal::pty::SpawnSpec;
use crate::workspace::model::{
    ItemId, Placement, RootPlacement, SplitId, SplitNode, TabId, WindowId,
};
use crate::workspace::reducer::Command;
use crate::workspace::replay::ModelError;
use crate::workspace::runtime::NotificationOrigin;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

impl ActorState {
    pub(super) async fn execute_cli(
        &mut self,
        cli_client_id: ClientId,
        request: CliExecuteRequest,
    ) -> Result<Value, ProtocolErrorCode> {
        let expected = request.expected_structure_revision;
        let context_pane_id = request.context_pane_id;
        match request.action {
            CliAction::Tree => serde_json::to_value(self.model.snapshot(cli_client_id))
                .map_err(|_| ProtocolErrorCode::Internal),
            CliAction::Diagnostic => {
                let terminals = self.terminals.list().await.map_err(terminal_error_code)?;
                Ok(json!({
                    "host_id": self.configuration.host_id,
                    "epoch": self.configuration.epoch,
                    "build": self.configuration.build,
                    "revision": self.model.revision(),
                    "structure_revision": self.model.structure_revision(),
                    "capabilities": self.configuration.capabilities,
                    "terminals": terminals,
                    "settings": self.settings,
                }))
            }
            CliAction::WindowNew => {
                let window_id = WindowId(Uuid::new_v4());
                self.apply_cli(
                    Command::AddWindow { window_id },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await?;
                let space_id = self.model.workspace().spaces[0].id;
                let pane_id = PaneId(Uuid::new_v4());
                let tab_id = TabId(Uuid::new_v4());
                let applied = self
                    .apply_cli(
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
                        None,
                        BTreeMap::from([(pane_id, self.spawn_spec(None, Vec::new(), None)?)]),
                        false,
                    )
                    .await?;
                Ok(
                    json!({"window_id": window_id, "tab_id": tab_id, "pane_id": pane_id, "applied": applied}),
                )
            }
            CliAction::WindowClose { target, force } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Window, &target)?;
                self.apply_value(
                    Command::CloseWindow {
                        window_id: location.window_id,
                    },
                    expected,
                    BTreeMap::new(),
                    force,
                )
                .await
            }
            CliAction::SpaceList => serde_json::to_value(&self.model.workspace().spaces)
                .map_err(|_| ProtocolErrorCode::Internal),
            CliAction::SpaceNew { name, color } => {
                let space_id = crate::workspace::model::SpaceId(Uuid::new_v4());
                let applied = self
                    .apply_cli(
                        Command::AddSpace {
                            space_id,
                            name,
                            color,
                        },
                        expected,
                        BTreeMap::new(),
                        false,
                    )
                    .await?;
                Ok(json!({"space_id": space_id, "applied": applied}))
            }
            CliAction::SpaceSelect { target } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Space, &target)?;
                let client_id = self.active_client(location.window_id)?;
                self.apply_value(
                    Command::SelectSpace {
                        client_id,
                        window_id: location.window_id,
                        space_id: location.space_id,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::SpaceClose { target, force } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Space, &target)?;
                self.apply_value(
                    Command::DeleteSpace {
                        space_id: location.space_id,
                    },
                    expected,
                    BTreeMap::new(),
                    force,
                )
                .await
            }
            CliAction::SpaceRename { target, name } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Space, &target)?;
                self.apply_value(
                    Command::RenameSpace {
                        space_id: location.space_id,
                        name,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::SpaceColor { target, color } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Space, &target)?;
                self.apply_value(
                    Command::SetSpaceColor {
                        space_id: location.space_id,
                        color,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::SpaceMove { target, index } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Space, &target)?;
                self.apply_value(
                    Command::ReorderSpace {
                        space_id: location.space_id,
                        index,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::SpaceNavigate { direction } => {
                let (client_id, location) = self.navigation_context(context_pane_id)?;
                let client = self
                    .model
                    .clients()
                    .iter()
                    .find(|client| client.id == client_id)
                    .ok_or(ProtocolErrorCode::NotFound)?;
                let current = client.windows[&location.window_id].displayed_space_id;
                let space_id = match direction {
                    CliNavigation::Last => client.windows[&location.window_id]
                        .previous_space_id
                        .ok_or(ProtocolErrorCode::NotFound)?,
                    CliNavigation::Next | CliNavigation::Previous => {
                        let spaces = &self.model.workspace().spaces;
                        let current_index = spaces
                            .iter()
                            .position(|space| space.id == current)
                            .ok_or(ProtocolErrorCode::NotFound)?;
                        let index = if direction == CliNavigation::Next {
                            (current_index + 1) % spaces.len()
                        } else {
                            (current_index + spaces.len() - 1) % spaces.len()
                        };
                        spaces[index].id
                    }
                };
                self.apply_value(
                    Command::SelectSpace {
                        client_id,
                        window_id: location.window_id,
                        space_id,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupNew {
                tab_targets,
                name,
                color,
            } => {
                let locations = if tab_targets.is_empty() {
                    Vec::new()
                } else {
                    tab_targets
                        .iter()
                        .map(|target| self.resolve(context_pane_id, CliTargetKind::Tab, target))
                        .collect::<Result<Vec<_>, _>>()?
                };
                let anchor = locations.first().copied().unwrap_or(self.resolve(
                    context_pane_id,
                    CliTargetKind::Space,
                    &CliTarget::Ambient,
                )?);
                if locations.iter().any(|location| {
                    location.window_id != anchor.window_id || location.space_id != anchor.space_id
                }) {
                    return Err(ProtocolErrorCode::InvalidRequest);
                }
                let group_id = crate::workspace::model::GroupId(Uuid::new_v4());
                let applied = self
                    .apply_cli(
                        Command::CreateGroup {
                            window_id: anchor.window_id,
                            space_id: anchor.space_id,
                            group_id,
                            title: name,
                            color,
                            tab_ids: locations
                                .into_iter()
                                .filter_map(|location| location.tab_id)
                                .collect(),
                        },
                        expected,
                        BTreeMap::new(),
                        false,
                    )
                    .await?;
                Ok(json!({"group_id": group_id, "applied": applied}))
            }
            CliAction::GroupRename { target, name } => {
                let group_id = self.group_id(context_pane_id, &target)?;
                self.apply_value(
                    Command::RenameGroup {
                        group_id,
                        title: name,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupColor { target, color } => {
                let group_id = self.group_id(context_pane_id, &target)?;
                self.apply_value(
                    Command::SetGroupColor { group_id, color },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupPin { target, pinned } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Group, &target)?;
                let group_id = location.group_id.ok_or(ProtocolErrorCode::NotFound)?;
                self.apply_value(
                    Command::MoveItems {
                        source_window_id: location.window_id,
                        source_space_id: location.space_id,
                        item_ids: vec![ItemId::Group(group_id)],
                        destination_window_id: location.window_id,
                        destination_space_id: location.space_id,
                        destination: Placement::Root(RootPlacement { pinned, index: 0 }),
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupCollapse { target, collapsed } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Group, &target)?;
                let client_id = self.active_client(location.window_id)?;
                self.apply_value(
                    Command::SetGroupCollapsed {
                        client_id,
                        window_id: location.window_id,
                        space_id: location.space_id,
                        group_id: location.group_id.ok_or(ProtocolErrorCode::NotFound)?,
                        collapsed,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupMove {
                target,
                destination_space,
                index,
                pinned,
            } => {
                let source = self.resolve(context_pane_id, CliTargetKind::Group, &target)?;
                let destination =
                    self.resolve(context_pane_id, CliTargetKind::Space, &destination_space)?;
                self.apply_value(
                    Command::MoveItems {
                        source_window_id: source.window_id,
                        source_space_id: source.space_id,
                        item_ids: vec![ItemId::Group(
                            source.group_id.ok_or(ProtocolErrorCode::NotFound)?,
                        )],
                        destination_window_id: destination.window_id,
                        destination_space_id: destination.space_id,
                        destination: Placement::Root(RootPlacement { pinned, index }),
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupUngroup { target } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Group, &target)?;
                self.apply_value(
                    Command::Ungroup {
                        window_id: location.window_id,
                        space_id: location.space_id,
                        group_id: location.group_id.ok_or(ProtocolErrorCode::NotFound)?,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::GroupClose { target, force } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Group, &target)?;
                self.apply_value(
                    Command::CloseGroup {
                        window_id: location.window_id,
                        space_id: location.space_id,
                        group_id: location.group_id.ok_or(ProtocolErrorCode::NotFound)?,
                    },
                    expected,
                    BTreeMap::new(),
                    force,
                )
                .await
            }
            CliAction::TabNew {
                space,
                title,
                cwd,
                pinned,
                script,
                argv,
            } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Space, &space)?;
                let index = self
                    .model
                    .workspace()
                    .content(location.window_id, location.space_id)
                    .map(|content| {
                        if pinned {
                            content.pinned_roots.len()
                        } else {
                            content.regular_roots.len()
                        }
                    })
                    .ok_or(ProtocolErrorCode::NotFound)?;
                let pane_id = PaneId(Uuid::new_v4());
                let tab_id = TabId(Uuid::new_v4());
                let spec = self.spawn_spec(cwd.clone(), argv, script)?;
                let applied = self
                    .apply_cli(
                        Command::CreateTab {
                            window_id: location.window_id,
                            space_id: location.space_id,
                            tab_id,
                            pane_id,
                            placement: Placement::Root(RootPlacement { pinned, index }),
                            title,
                            restart_directory: cwd,
                        },
                        expected,
                        BTreeMap::from([(pane_id, spec)]),
                        false,
                    )
                    .await?;
                Ok(json!({"tab_id": tab_id, "pane_id": pane_id, "applied": applied}))
            }
            CliAction::TabSelect { target } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Tab, &target)?;
                let client_id = self.active_client(location.window_id)?;
                self.apply_value(
                    Command::SelectTab {
                        client_id,
                        window_id: location.window_id,
                        space_id: location.space_id,
                        tab_id: location.tab_id.ok_or(ProtocolErrorCode::NotFound)?,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::TabClose { target, force } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Tab, &target)?;
                self.apply_value(
                    Command::CloseTab {
                        window_id: location.window_id,
                        space_id: location.space_id,
                        tab_id: location.tab_id.ok_or(ProtocolErrorCode::NotFound)?,
                    },
                    expected,
                    BTreeMap::new(),
                    force,
                )
                .await
            }
            CliAction::TabRename { target, title } => {
                let tab_id = self.tab_id(context_pane_id, &target)?;
                self.apply_value(
                    Command::RenameTab { tab_id, title },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::TabTitle { target } => {
                let tab_id = self.tab_id(context_pane_id, &target)?;
                let tab = self
                    .model
                    .workspace()
                    .tab(tab_id)
                    .ok_or(ProtocolErrorCode::NotFound)?;
                let title = tab.title.clone().or_else(|| {
                    tab.root.leaves().first().and_then(|pane_id| {
                        self.model
                            .pane_facts()
                            .get(pane_id)
                            .and_then(|facts| facts.title.clone())
                    })
                });
                Ok(json!({"tab_id": tab_id, "title": title}))
            }
            CliAction::TabPin { target, pinned } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Tab, &target)?;
                let tab_id = location.tab_id.ok_or(ProtocolErrorCode::NotFound)?;
                self.apply_value(
                    Command::MoveItems {
                        source_window_id: location.window_id,
                        source_space_id: location.space_id,
                        item_ids: vec![ItemId::Tab(tab_id)],
                        destination_window_id: location.window_id,
                        destination_space_id: location.space_id,
                        destination: Placement::Root(RootPlacement { pinned, index: 0 }),
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::TabMove {
                target,
                destination_space,
                destination_group,
                index,
                pinned,
            } => {
                let source = self.resolve(context_pane_id, CliTargetKind::Tab, &target)?;
                let destination =
                    self.resolve(context_pane_id, CliTargetKind::Space, &destination_space)?;
                let placement = match destination_group {
                    Some(target) => {
                        let group = self.resolve(context_pane_id, CliTargetKind::Group, &target)?;
                        if group.window_id != destination.window_id
                            || group.space_id != destination.space_id
                        {
                            return Err(ProtocolErrorCode::InvalidRequest);
                        }
                        Placement::Group {
                            group_id: group.group_id.ok_or(ProtocolErrorCode::NotFound)?,
                            index,
                        }
                    }
                    None => Placement::Root(RootPlacement { pinned, index }),
                };
                self.apply_value(
                    Command::MoveItems {
                        source_window_id: source.window_id,
                        source_space_id: source.space_id,
                        item_ids: vec![ItemId::Tab(
                            source.tab_id.ok_or(ProtocolErrorCode::NotFound)?,
                        )],
                        destination_window_id: destination.window_id,
                        destination_space_id: destination.space_id,
                        destination: placement,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::TabNavigate { direction } => {
                let (client_id, location) = self.navigation_context(context_pane_id)?;
                let client = self
                    .model
                    .clients()
                    .iter()
                    .find(|client| client.id == client_id)
                    .ok_or(ProtocolErrorCode::NotFound)?;
                let window = &client.windows[&location.window_id];
                let current = window
                    .selected_tab_by_space
                    .get(&location.space_id)
                    .copied()
                    .ok_or(ProtocolErrorCode::NotFound)?;
                let tab_id = match direction {
                    CliNavigation::Last => window
                        .previous_tab_by_space
                        .get(&location.space_id)
                        .copied()
                        .ok_or(ProtocolErrorCode::NotFound)?,
                    CliNavigation::Next | CliNavigation::Previous => {
                        let tabs = self
                            .model
                            .workspace()
                            .content(location.window_id, location.space_id)
                            .ok_or(ProtocolErrorCode::NotFound)?
                            .flat_tabs();
                        let current_index = tabs
                            .iter()
                            .position(|tab_id| *tab_id == current)
                            .ok_or(ProtocolErrorCode::NotFound)?;
                        let index = if direction == CliNavigation::Next {
                            (current_index + 1) % tabs.len()
                        } else {
                            (current_index + tabs.len() - 1) % tabs.len()
                        };
                        tabs[index]
                    }
                };
                self.apply_value(
                    Command::SelectTab {
                        client_id,
                        window_id: location.window_id,
                        space_id: location.space_id,
                        tab_id,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::PaneSplit {
                target,
                direction,
                placement,
                cwd,
                script,
                argv,
            } => {
                let mut location = self
                    .resolve(context_pane_id, CliTargetKind::Pane, &target)
                    .or_else(|_| self.resolve(context_pane_id, CliTargetKind::Tab, &target))?;
                if location.pane_id.is_none() {
                    let tab_id = location.tab_id.ok_or(ProtocolErrorCode::NotFound)?;
                    let client_id = self.active_client(location.window_id)?;
                    location.pane_id = self
                        .model
                        .clients()
                        .iter()
                        .find(|client| client.id == client_id)
                        .and_then(|client| client.windows.get(&location.window_id))
                        .and_then(|window| window.focused_pane_by_tab.get(&tab_id))
                        .copied()
                        .or_else(|| {
                            self.model
                                .workspace()
                                .tab(tab_id)
                                .and_then(|tab| tab.root.leaves().first().copied())
                        });
                }
                let pane_id = PaneId(Uuid::new_v4());
                let spec = self.spawn_spec(cwd.clone(), argv, script)?;
                let applied = self
                    .apply_cli(
                        Command::SplitPane {
                            window_id: location.window_id,
                            space_id: location.space_id,
                            tab_id: location.tab_id.ok_or(ProtocolErrorCode::NotFound)?,
                            target_pane_id: location.pane_id.ok_or(ProtocolErrorCode::NotFound)?,
                            pane_id,
                            split_id: SplitId(Uuid::new_v4()),
                            direction,
                            placement,
                            restart_directory: cwd,
                        },
                        expected,
                        BTreeMap::from([(pane_id, spec)]),
                        false,
                    )
                    .await?;
                Ok(json!({"pane_id": pane_id, "applied": applied}))
            }
            CliAction::PaneFocus { target } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Pane, &target)?;
                let client_id = self.active_client(location.window_id)?;
                self.apply_value(
                    Command::FocusPane {
                        client_id,
                        window_id: location.window_id,
                        space_id: location.space_id,
                        tab_id: location.tab_id.ok_or(ProtocolErrorCode::NotFound)?,
                        pane_id: location.pane_id.ok_or(ProtocolErrorCode::NotFound)?,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::PaneClose { target, force } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                self.apply_value(
                    Command::ClosePane { pane_id },
                    expected,
                    BTreeMap::new(),
                    force,
                )
                .await
            }
            CliAction::PaneMoveToNewTab {
                target,
                destination_space,
                index,
                pinned,
            } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                let destination =
                    self.resolve(context_pane_id, CliTargetKind::Space, &destination_space)?;
                let tab_id = TabId(Uuid::new_v4());
                let applied = self
                    .apply_cli(
                        Command::MovePaneToNewTab {
                            pane_id,
                            tab_id,
                            destination_window_id: destination.window_id,
                            destination_space_id: destination.space_id,
                            destination: Placement::Root(RootPlacement { pinned, index }),
                            title: None,
                        },
                        expected,
                        BTreeMap::new(),
                        false,
                    )
                    .await?;
                Ok(json!({"tab_id": tab_id, "applied": applied}))
            }
            CliAction::PaneMoveToTab {
                target,
                destination_tab,
                target_pane,
                direction,
                placement,
            } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                let destination_tab_id = self.tab_id(context_pane_id, &destination_tab)?;
                let target_pane_id = self.pane_id(context_pane_id, &target_pane)?;
                self.apply_value(
                    Command::MovePaneToTab {
                        pane_id,
                        destination_tab_id,
                        target_pane_id,
                        split_id: SplitId(Uuid::new_v4()),
                        direction,
                        placement,
                    },
                    expected,
                    BTreeMap::new(),
                    false,
                )
                .await
            }
            CliAction::PaneCapture { target } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                let text = self
                    .terminals
                    .capture(pane_id)
                    .await
                    .map_err(terminal_error_code)?;
                Ok(json!({"pane_id": pane_id, "text": text}))
            }
            CliAction::PaneHealth { target } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                let terminal = self
                    .terminals
                    .info(pane_id)
                    .await
                    .map_err(terminal_error_code)?;
                let pane = self.model.pane_facts().get(&pane_id);
                let agent = self.model.agent_facts().get(&pane_id);
                Ok(json!({"terminal": terminal, "pane": pane, "agent": agent}))
            }
            CliAction::PaneResize { target, viewport } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                let attachment = self
                    .terminals
                    .attach(pane_id, cli_client_id)
                    .await
                    .map_err(terminal_error_code)?;
                let generation = self
                    .terminals
                    .claim_writer(pane_id, cli_client_id)
                    .await
                    .map_err(terminal_error_code)?;
                self.terminals
                    .resize(pane_id, cli_client_id, generation, viewport)
                    .await
                    .map_err(terminal_error_code)?;
                self.terminals
                    .detach(pane_id, cli_client_id)
                    .await
                    .map_err(terminal_error_code)?;
                drop(attachment);
                Ok(json!({"resized": true}))
            }
            CliAction::PaneInput { target, bytes } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                let attachment = self
                    .terminals
                    .attach(pane_id, cli_client_id)
                    .await
                    .map_err(terminal_error_code)?;
                let generation = self
                    .terminals
                    .claim_writer(pane_id, cli_client_id)
                    .await
                    .map_err(terminal_error_code)?;
                self.terminals
                    .input(pane_id, cli_client_id, generation, bytes)
                    .await
                    .map_err(terminal_error_code)?;
                self.terminals
                    .detach(pane_id, cli_client_id)
                    .await
                    .map_err(terminal_error_code)?;
                drop(attachment);
                Ok(json!({"sent": true}))
            }
            CliAction::PaneLayout { target, layout } => {
                let location = self.resolve(context_pane_id, CliTargetKind::Tab, &target)?;
                let tab_id = location.tab_id.ok_or(ProtocolErrorCode::NotFound)?;
                let tab = self
                    .model
                    .workspace()
                    .tab(tab_id)
                    .ok_or(ProtocolErrorCode::NotFound)?;
                let mut split_ids = Vec::new();
                collect_split_ids(&tab.root, &mut split_ids);
                let command = match layout {
                    CliPaneLayout::Tile => Command::TileTab {
                        window_id: location.window_id,
                        space_id: location.space_id,
                        tab_id,
                        split_ids,
                    },
                    CliPaneLayout::MainVertical => Command::MainVerticalTab {
                        window_id: location.window_id,
                        space_id: location.space_id,
                        tab_id,
                        split_ids,
                    },
                };
                self.apply_value(command, expected, BTreeMap::new(), false)
                    .await
            }
            CliAction::Notify {
                target,
                title,
                body,
            } => {
                let pane_id = self.pane_id(context_pane_id, &target)?;
                self.model.notify(
                    pane_id,
                    NotificationOrigin::Desktop,
                    title,
                    body,
                    super::timestamp_millis(),
                );
                self.persist().await;
                Ok(json!({"notified": true}))
            }
            CliAction::SettingsList => Ok(json!(self.settings)),
            CliAction::SettingsGet { key } => self
                .settings
                .get(&key)
                .cloned()
                .ok_or(ProtocolErrorCode::NotFound),
            CliAction::SettingsSet { key, value } => {
                validate_setting(&key, &value)?;
                self.settings.insert(key.clone(), value.clone());
                self.persist().await;
                Ok(json!({"key": key, "value": value}))
            }
            CliAction::SettingsReset { key } => {
                if let Some(key) = key {
                    validate_setting_key(&key)?;
                    self.settings.remove(&key);
                } else {
                    self.settings.clear();
                }
                self.persist().await;
                Ok(json!({"reset": true}))
            }
        }
    }

    fn resolve(
        &self,
        context_pane_id: Option<PaneId>,
        kind: CliTargetKind,
        target: &CliTarget,
    ) -> Result<TargetLocation, ProtocolErrorCode> {
        let active_clients = self
            .active_ui_connections
            .values()
            .copied()
            .collect::<BTreeSet<_>>();
        CliTargetResolver::new(
            self.model.workspace(),
            self.model.clients(),
            &active_clients,
            context_pane_id,
        )
        .resolve(kind, target)
        .map_err(target_error_code)
    }

    fn active_client(&self, window_id: WindowId) -> Result<ClientId, ProtocolErrorCode> {
        let active_clients = self
            .active_ui_connections
            .values()
            .copied()
            .collect::<BTreeSet<_>>();
        CliTargetResolver::new(
            self.model.workspace(),
            self.model.clients(),
            &active_clients,
            None,
        )
        .active_client_for_window(window_id)
        .map_err(target_error_code)
    }

    fn navigation_context(
        &self,
        context_pane_id: Option<PaneId>,
    ) -> Result<(ClientId, TargetLocation), ProtocolErrorCode> {
        let location = self.resolve(context_pane_id, CliTargetKind::Window, &CliTarget::Ambient)?;
        Ok((self.active_client(location.window_id)?, location))
    }

    fn pane_id(
        &self,
        context_pane_id: Option<PaneId>,
        target: &CliTarget,
    ) -> Result<PaneId, ProtocolErrorCode> {
        self.resolve(context_pane_id, CliTargetKind::Pane, target)?
            .pane_id
            .ok_or(ProtocolErrorCode::NotFound)
    }

    fn tab_id(
        &self,
        context_pane_id: Option<PaneId>,
        target: &CliTarget,
    ) -> Result<TabId, ProtocolErrorCode> {
        self.resolve(context_pane_id, CliTargetKind::Tab, target)?
            .tab_id
            .ok_or(ProtocolErrorCode::NotFound)
    }

    fn group_id(
        &self,
        context_pane_id: Option<PaneId>,
        target: &CliTarget,
    ) -> Result<crate::workspace::model::GroupId, ProtocolErrorCode> {
        self.resolve(context_pane_id, CliTargetKind::Group, target)?
            .group_id
            .ok_or(ProtocolErrorCode::NotFound)
    }

    async fn apply_value(
        &mut self,
        command: Command,
        expected_structure_revision: Option<u64>,
        spawn_specs: BTreeMap<PaneId, SpawnSpec>,
        force: bool,
    ) -> Result<Value, ProtocolErrorCode> {
        let applied = self
            .apply_cli(command, expected_structure_revision, spawn_specs, force)
            .await?;
        serde_json::to_value(applied).map_err(|_| ProtocolErrorCode::Internal)
    }

    async fn apply_cli(
        &mut self,
        command: Command,
        expected_structure_revision: Option<u64>,
        spawn_specs: BTreeMap<PaneId, SpawnSpec>,
        force: bool,
    ) -> Result<crate::workspace::replay::ApplyResult, ProtocolErrorCode> {
        let confirmation_tokens = if force {
            self.prepare_close(&command)
                .map_err(model_error_code)?
                .tokens
        } else {
            BTreeMap::new()
        };
        self.apply_workspace(ApplyRequest {
            command,
            expected_structure_revision,
            spawn_specs,
            confirmation_tokens,
        })
        .await
        .map_err(apply_error_code)
    }

    fn spawn_spec(
        &self,
        cwd: Option<std::path::PathBuf>,
        direct_argv: Vec<String>,
        script: Option<String>,
    ) -> Result<SpawnSpec, ProtocolErrorCode> {
        if !direct_argv.is_empty() && script.is_some() {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        let argv = if !direct_argv.is_empty() {
            direct_argv
        } else if let Some(script) = script {
            let shell = self
                .settings
                .get("terminal.shell")
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| std::env::var("SHELL").ok())
                .unwrap_or_else(|| "/bin/sh".into());
            vec![
                shell,
                "-lic".into(),
                format!("{script}; exec \"$SHELL\" -l"),
            ]
        } else {
            Vec::new()
        };
        let mut spec = SpawnSpec {
            argv,
            cwd,
            environment: Vec::new(),
            rows: 24,
            columns: 80,
            pixel_width: 800,
            pixel_height: 480,
        };
        self.configure_spawn_spec(&mut spec);
        Ok(spec)
    }
}

fn collect_split_ids(node: &SplitNode, split_ids: &mut Vec<SplitId>) {
    match node {
        SplitNode::Pane { .. } => {}
        SplitNode::Split {
            split_id,
            first,
            second,
            ..
        } => {
            split_ids.push(*split_id);
            collect_split_ids(first, split_ids);
            collect_split_ids(second, split_ids);
        }
    }
}

pub(super) fn validate_setting(key: &str, value: &Value) -> Result<(), ProtocolErrorCode> {
    validate_setting_key(key)?;
    let valid = match key {
        "terminal.shell" => value.as_array().is_some_and(|values| {
            !values.is_empty()
                && values
                    .iter()
                    .all(|value| value.as_str().is_some_and(|value| !value.is_empty()))
        }),
        "terminal.environment" => value.as_object().is_some_and(|values| {
            values
                .iter()
                .all(|(key, value)| !key.is_empty() && value.is_string())
        }),
        "terminal.scrollback_lines" => value
            .as_u64()
            .is_some_and(|value| (1_000..=1_000_000).contains(&value)),
        "agent.rules" => value.is_array(),
        "integrations.auto_repair" => value.is_boolean(),
        "machine.name" => value
            .as_str()
            .is_some_and(|value| !value.trim().is_empty() && value.len() <= 128),
        _ => false,
    };
    valid.then_some(()).ok_or(ProtocolErrorCode::InvalidRequest)
}

pub(super) fn validate_setting_key(key: &str) -> Result<(), ProtocolErrorCode> {
    matches!(
        key,
        "terminal.shell"
            | "terminal.environment"
            | "terminal.scrollback_lines"
            | "agent.rules"
            | "integrations.auto_repair"
            | "machine.name"
    )
    .then_some(())
    .ok_or(ProtocolErrorCode::NotFound)
}

fn target_error_code(error: CliTargetError) -> ProtocolErrorCode {
    match error {
        CliTargetError::NotFound => ProtocolErrorCode::NotFound,
        CliTargetError::NoAmbientTarget
        | CliTargetError::AmbiguousAmbientTarget
        | CliTargetError::Ambiguous
        | CliTargetError::WrongKind
        | CliTargetError::InvalidPath => ProtocolErrorCode::InvalidRequest,
    }
}

fn terminal_error_code(error: TerminalError) -> ProtocolErrorCode {
    match error {
        TerminalError::NotFound => ProtocolErrorCode::NotFound,
        TerminalError::AlreadyExists
        | TerminalError::NotAttached
        | TerminalError::StaleWriter
        | TerminalError::InputTooLarge => ProtocolErrorCode::InvalidRequest,
        TerminalError::Spawn(_)
        | TerminalError::InputQueueFull
        | TerminalError::Stopped
        | TerminalError::Pty(_)
        | TerminalError::State(_) => ProtocolErrorCode::Internal,
    }
}

fn model_error_code(error: ModelError) -> ProtocolErrorCode {
    match error {
        ModelError::StaleStructure { .. } => ProtocolErrorCode::StaleStructure,
        ModelError::Reducer(crate::workspace::reducer::ReducerError::NotFound) => {
            ProtocolErrorCode::NotFound
        }
        ModelError::Reducer(_) => ProtocolErrorCode::InvalidRequest,
    }
}

fn apply_error_code(error: ApplyWorkspaceError) -> ProtocolErrorCode {
    match error {
        ApplyWorkspaceError::Model(error) => model_error_code(error),
        ApplyWorkspaceError::SpawnSpecs => ProtocolErrorCode::InvalidRequest,
        ApplyWorkspaceError::ConfirmationRequired(_) => ProtocolErrorCode::ConfirmationRequired,
        ApplyWorkspaceError::Unsupported => ProtocolErrorCode::CapabilityUnavailable,
        ApplyWorkspaceError::LicenseRequired => ProtocolErrorCode::LicenseRequired,
    }
}
