use crate::protocol::control::ClientId;
use crate::protocol::terminal::PaneId;
use crate::terminal::actor::Viewport;
use crate::workspace::model::{
    ClientState, GroupId, ItemId, Placement, SpaceId, SplitDirection, SplitPlacement, TabId,
    WindowId, Workspace,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CliExecuteRequest {
    pub context_pane_id: Option<PaneId>,
    pub expected_structure_revision: Option<u64>,
    pub action: CliAction,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CliAction {
    Tree,
    Diagnostic,
    WindowNew,
    WindowClose {
        target: CliTarget,
        force: bool,
    },
    SpaceList,
    SpaceNew {
        name: String,
        color: String,
    },
    SpaceSelect {
        target: CliTarget,
    },
    SpaceClose {
        target: CliTarget,
        force: bool,
    },
    SpaceRename {
        target: CliTarget,
        name: String,
    },
    SpaceColor {
        target: CliTarget,
        color: String,
    },
    SpaceMove {
        target: CliTarget,
        index: usize,
    },
    SpaceNavigate {
        direction: CliNavigation,
    },
    GroupNew {
        tab_targets: Vec<CliTarget>,
        name: String,
        color: String,
    },
    GroupRename {
        target: CliTarget,
        name: String,
    },
    GroupColor {
        target: CliTarget,
        color: String,
    },
    GroupPin {
        target: CliTarget,
        pinned: bool,
    },
    GroupCollapse {
        target: CliTarget,
        collapsed: bool,
    },
    GroupMove {
        target: CliTarget,
        destination_space: CliTarget,
        index: usize,
        pinned: bool,
    },
    GroupUngroup {
        target: CliTarget,
    },
    GroupClose {
        target: CliTarget,
        force: bool,
    },
    TabNew {
        space: CliTarget,
        title: Option<String>,
        cwd: Option<PathBuf>,
        pinned: bool,
        script: Option<String>,
        argv: Vec<String>,
    },
    TabSelect {
        target: CliTarget,
    },
    TabClose {
        target: CliTarget,
        force: bool,
    },
    TabRename {
        target: CliTarget,
        title: Option<String>,
    },
    TabTitle {
        target: CliTarget,
    },
    TabPin {
        target: CliTarget,
        pinned: bool,
    },
    TabMove {
        target: CliTarget,
        destination_space: CliTarget,
        destination_group: Option<CliTarget>,
        index: usize,
        pinned: bool,
    },
    TabNavigate {
        direction: CliNavigation,
    },
    PaneSplit {
        target: CliTarget,
        direction: SplitDirection,
        placement: SplitPlacement,
        cwd: Option<PathBuf>,
        script: Option<String>,
        argv: Vec<String>,
    },
    PaneFocus {
        target: CliTarget,
    },
    PaneClose {
        target: CliTarget,
        force: bool,
    },
    PaneMoveToNewTab {
        target: CliTarget,
        destination_space: CliTarget,
        index: usize,
        pinned: bool,
    },
    PaneMoveToTab {
        target: CliTarget,
        destination_tab: CliTarget,
        target_pane: CliTarget,
        direction: SplitDirection,
        placement: SplitPlacement,
    },
    PaneCapture {
        target: CliTarget,
    },
    PaneHealth {
        target: CliTarget,
    },
    PaneResize {
        target: CliTarget,
        viewport: Viewport,
    },
    PaneInput {
        target: CliTarget,
        bytes: Vec<u8>,
    },
    PaneLayout {
        target: CliTarget,
        layout: CliPaneLayout,
    },
    Notify {
        target: CliTarget,
        title: Option<String>,
        body: Option<String>,
    },
    SettingsList,
    SettingsGet {
        key: String,
    },
    SettingsSet {
        key: String,
        value: serde_json::Value,
    },
    SettingsReset {
        key: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliPaneLayout {
    Tile,
    MainVertical,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliNavigation {
    Next,
    Previous,
    Last,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CliTarget {
    Ambient,
    Id { id: Uuid },
    Short { kind: CliTargetKind, prefix: String },
    Path { indexes: Vec<usize> },
    Name { value: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliTargetKind {
    Window,
    Space,
    Group,
    Tab,
    Pane,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TargetLocation {
    pub window_id: WindowId,
    pub space_id: SpaceId,
    pub group_id: Option<GroupId>,
    pub tab_id: Option<TabId>,
    pub pane_id: Option<PaneId>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CliTargetError {
    #[error("no active UI target")]
    NoAmbientTarget,
    #[error("active UI target is ambiguous")]
    AmbiguousAmbientTarget,
    #[error("target not found")]
    NotFound,
    #[error("target is ambiguous")]
    Ambiguous,
    #[error("target kind does not match")]
    WrongKind,
    #[error("target path is invalid")]
    InvalidPath,
}

pub struct CliTargetResolver<'a> {
    workspace: &'a Workspace,
    clients: &'a [ClientState],
    active_clients: &'a BTreeSet<ClientId>,
    context_pane_id: Option<PaneId>,
}

impl<'a> CliTargetResolver<'a> {
    pub fn new(
        workspace: &'a Workspace,
        clients: &'a [ClientState],
        active_clients: &'a BTreeSet<ClientId>,
        context_pane_id: Option<PaneId>,
    ) -> Self {
        Self {
            workspace,
            clients,
            active_clients,
            context_pane_id,
        }
    }

    pub fn resolve(
        &self,
        kind: CliTargetKind,
        target: &CliTarget,
    ) -> Result<TargetLocation, CliTargetError> {
        match target {
            CliTarget::Ambient => self.ambient(kind),
            CliTarget::Id { id } => self.resolve_id(kind, *id),
            CliTarget::Short {
                kind: target_kind,
                prefix,
            } => {
                if *target_kind != kind {
                    return Err(CliTargetError::WrongKind);
                }
                self.resolve_short(kind, prefix)
            }
            CliTarget::Path { indexes } => self.resolve_path(kind, indexes),
            CliTarget::Name { value } if kind == CliTargetKind::Group => {
                self.resolve_group_name(value)
            }
            CliTarget::Name { .. } => Err(CliTargetError::WrongKind),
        }
    }

    pub fn active_client_for_window(
        &self,
        window_id: WindowId,
    ) -> Result<ClientId, CliTargetError> {
        let matches: BTreeSet<_> = self
            .clients
            .iter()
            .filter(|client| self.active_clients.contains(&client.id))
            .filter(|client| client.windows.contains_key(&window_id))
            .map(|client| client.id)
            .collect();
        match matches.len() {
            0 => Err(CliTargetError::NoAmbientTarget),
            1 => Ok(*matches.first().unwrap()),
            _ => Err(CliTargetError::AmbiguousAmbientTarget),
        }
    }

    fn ambient(&self, kind: CliTargetKind) -> Result<TargetLocation, CliTargetError> {
        if let Some(pane_id) = self.context_pane_id {
            let location = self.pane_location(pane_id)?;
            return self.promote(location, kind);
        }
        let (client, window_id) = self.active_window()?;
        let window = client
            .windows
            .get(&window_id)
            .ok_or(CliTargetError::NotFound)?;
        let space_id = window.displayed_space_id;
        let tab_id = window.selected_tab_by_space.get(&space_id).copied();
        let pane_id = tab_id.and_then(|tab_id| window.focused_pane_by_tab.get(&tab_id).copied());
        let location = TargetLocation {
            window_id,
            space_id,
            group_id: tab_id.and_then(|tab_id| self.group_containing(window_id, space_id, tab_id)),
            tab_id,
            pane_id,
        };
        self.promote(location, kind)
    }

    fn active_window(&self) -> Result<(&ClientState, WindowId), CliTargetError> {
        let candidates: Vec<_> = self
            .clients
            .iter()
            .filter(|client| self.active_clients.contains(&client.id))
            .filter_map(|client| client.active_window_id.map(|window_id| (client, window_id)))
            .collect();
        let windows: BTreeSet<_> = candidates.iter().map(|(_, window_id)| *window_id).collect();
        if windows.is_empty() {
            return Err(CliTargetError::NoAmbientTarget);
        }
        if windows.len() != 1 {
            return Err(CliTargetError::AmbiguousAmbientTarget);
        }
        candidates
            .into_iter()
            .find(|(_, window_id)| Some(*window_id) == windows.first().copied())
            .ok_or(CliTargetError::NoAmbientTarget)
    }

    fn promote(
        &self,
        location: TargetLocation,
        kind: CliTargetKind,
    ) -> Result<TargetLocation, CliTargetError> {
        let present = match kind {
            CliTargetKind::Window | CliTargetKind::Space => true,
            CliTargetKind::Group => location.group_id.is_some(),
            CliTargetKind::Tab => location.tab_id.is_some(),
            CliTargetKind::Pane => location.pane_id.is_some(),
        };
        present.then_some(location).ok_or(CliTargetError::NotFound)
    }

    fn resolve_id(&self, kind: CliTargetKind, id: Uuid) -> Result<TargetLocation, CliTargetError> {
        match kind {
            CliTargetKind::Window => self.window_location(WindowId(id)),
            CliTargetKind::Space => {
                let window_id = self.default_window()?;
                self.space_location(window_id, SpaceId(id))
            }
            CliTargetKind::Group => self.group_location(GroupId(id)),
            CliTargetKind::Tab => self.tab_location(TabId(id)),
            CliTargetKind::Pane => self.pane_location(PaneId(id)),
        }
    }

    fn resolve_short(
        &self,
        kind: CliTargetKind,
        prefix: &str,
    ) -> Result<TargetLocation, CliTargetError> {
        if !(8..=32).contains(&prefix.len()) || !prefix.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(CliTargetError::NotFound);
        }
        let ids = self.ids(kind);
        let matches: Vec<_> = ids
            .into_iter()
            .filter(|id| compact(*id).starts_with(&prefix.to_ascii_lowercase()))
            .collect();
        match matches.as_slice() {
            [id] => self.resolve_id(kind, *id),
            [] => Err(CliTargetError::NotFound),
            _ => Err(CliTargetError::Ambiguous),
        }
    }

    fn ids(&self, kind: CliTargetKind) -> Vec<Uuid> {
        match kind {
            CliTargetKind::Window => self.workspace.windows.keys().map(|id| id.0).collect(),
            CliTargetKind::Space => self
                .workspace
                .spaces
                .iter()
                .map(|space| space.id.0)
                .collect(),
            CliTargetKind::Group => self
                .workspace
                .windows
                .values()
                .flat_map(|window| window.spaces.values())
                .flat_map(|content| content.groups.keys().map(|id| id.0))
                .collect(),
            CliTargetKind::Tab => self
                .workspace
                .windows
                .values()
                .flat_map(|window| window.spaces.values())
                .flat_map(|content| content.tabs.keys().map(|id| id.0))
                .collect(),
            CliTargetKind::Pane => self.workspace.pane_ids().map(|id| id.0).collect(),
        }
    }

    fn resolve_path(
        &self,
        kind: CliTargetKind,
        indexes: &[usize],
    ) -> Result<TargetLocation, CliTargetError> {
        if indexes.contains(&0) {
            return Err(CliTargetError::InvalidPath);
        }
        let ambient_window = || self.default_window();
        let (window_index, space_index, tab_index, pane_index) = match (kind, indexes) {
            (CliTargetKind::Window, [window]) => (Some(*window), None, None, None),
            (CliTargetKind::Space, [space]) => (None, Some(*space), None, None),
            (CliTargetKind::Space, [window, space]) => (Some(*window), Some(*space), None, None),
            (CliTargetKind::Tab, [space, tab]) => (None, Some(*space), Some(*tab), None),
            (CliTargetKind::Tab, [window, space, tab]) => {
                (Some(*window), Some(*space), Some(*tab), None)
            }
            (CliTargetKind::Pane, [space, tab, pane]) => {
                (None, Some(*space), Some(*tab), Some(*pane))
            }
            (CliTargetKind::Pane, [window, space, tab, pane]) => {
                (Some(*window), Some(*space), Some(*tab), Some(*pane))
            }
            _ => return Err(CliTargetError::InvalidPath),
        };
        let window_id = match window_index {
            Some(index) => self.window_at(index)?,
            None => ambient_window()?,
        };
        let Some(space_index) = space_index else {
            return self.window_location(window_id);
        };
        let space_id = self
            .workspace
            .spaces
            .get(space_index - 1)
            .map(|space| space.id)
            .ok_or(CliTargetError::NotFound)?;
        let Some(tab_index) = tab_index else {
            return self.space_location(window_id, space_id);
        };
        let content = self
            .workspace
            .content(window_id, space_id)
            .ok_or(CliTargetError::NotFound)?;
        let tab_id = content
            .flat_tabs()
            .get(tab_index - 1)
            .copied()
            .ok_or(CliTargetError::NotFound)?;
        let Some(pane_index) = pane_index else {
            return self.tab_location(tab_id);
        };
        let pane_id = content.tabs[&tab_id]
            .root
            .leaves()
            .get(pane_index - 1)
            .copied()
            .ok_or(CliTargetError::NotFound)?;
        self.pane_location(pane_id)
    }

    fn window_at(&self, index: usize) -> Result<WindowId, CliTargetError> {
        if let Ok((client, _)) = self.active_window()
            && let Some(window_id) = client.window_order.get(index - 1)
        {
            return Ok(*window_id);
        }
        self.workspace
            .windows
            .keys()
            .nth(index - 1)
            .copied()
            .ok_or(CliTargetError::NotFound)
    }

    fn default_window(&self) -> Result<WindowId, CliTargetError> {
        if let Ok((_, window_id)) = self.active_window() {
            return Ok(window_id);
        }
        match self.workspace.windows.len() {
            1 => self
                .workspace
                .windows
                .keys()
                .next()
                .copied()
                .ok_or(CliTargetError::NotFound),
            0 => Err(CliTargetError::NotFound),
            _ => Err(CliTargetError::AmbiguousAmbientTarget),
        }
    }

    fn resolve_group_name(&self, name: &str) -> Result<TargetLocation, CliTargetError> {
        let ambient = self.ambient(CliTargetKind::Space)?;
        let content = self
            .workspace
            .content(ambient.window_id, ambient.space_id)
            .ok_or(CliTargetError::NotFound)?;
        let matches: Vec<_> = content
            .groups
            .values()
            .filter(|group| group.title == name)
            .map(|group| group.id)
            .collect();
        match matches.as_slice() {
            [group_id] => self.group_location(*group_id),
            [] => Err(CliTargetError::NotFound),
            _ => Err(CliTargetError::Ambiguous),
        }
    }

    fn window_location(&self, window_id: WindowId) -> Result<TargetLocation, CliTargetError> {
        let window = self
            .workspace
            .windows
            .get(&window_id)
            .ok_or(CliTargetError::NotFound)?;
        let space_id = self
            .workspace
            .spaces
            .first()
            .map(|space| space.id)
            .filter(|space_id| window.spaces.contains_key(space_id))
            .ok_or(CliTargetError::NotFound)?;
        Ok(TargetLocation {
            window_id,
            space_id,
            group_id: None,
            tab_id: None,
            pane_id: None,
        })
    }

    fn space_location(
        &self,
        window_id: WindowId,
        space_id: SpaceId,
    ) -> Result<TargetLocation, CliTargetError> {
        self.workspace
            .content(window_id, space_id)
            .ok_or(CliTargetError::NotFound)?;
        Ok(TargetLocation {
            window_id,
            space_id,
            group_id: None,
            tab_id: None,
            pane_id: None,
        })
    }

    fn group_location(&self, group_id: GroupId) -> Result<TargetLocation, CliTargetError> {
        self.workspace
            .windows
            .iter()
            .flat_map(|(window_id, window)| {
                window.spaces.iter().filter_map(move |(space_id, content)| {
                    content
                        .groups
                        .contains_key(&group_id)
                        .then_some(TargetLocation {
                            window_id: *window_id,
                            space_id: *space_id,
                            group_id: Some(group_id),
                            tab_id: None,
                            pane_id: None,
                        })
                })
            })
            .next()
            .ok_or(CliTargetError::NotFound)
    }

    fn tab_location(&self, tab_id: TabId) -> Result<TargetLocation, CliTargetError> {
        self.workspace
            .windows
            .iter()
            .flat_map(|(window_id, window)| {
                window.spaces.iter().filter_map(move |(space_id, content)| {
                    content
                        .tabs
                        .contains_key(&tab_id)
                        .then_some(TargetLocation {
                            window_id: *window_id,
                            space_id: *space_id,
                            group_id: self.group_containing(*window_id, *space_id, tab_id),
                            tab_id: Some(tab_id),
                            pane_id: None,
                        })
                })
            })
            .next()
            .ok_or(CliTargetError::NotFound)
    }

    fn pane_location(&self, pane_id: PaneId) -> Result<TargetLocation, CliTargetError> {
        self.workspace
            .windows
            .iter()
            .flat_map(|(window_id, window)| {
                window.spaces.iter().flat_map(move |(space_id, content)| {
                    content.tabs.values().filter_map(move |tab| {
                        tab.root.contains_pane(pane_id).then_some(TargetLocation {
                            window_id: *window_id,
                            space_id: *space_id,
                            group_id: self.group_containing(*window_id, *space_id, tab.id),
                            tab_id: Some(tab.id),
                            pane_id: Some(pane_id),
                        })
                    })
                })
            })
            .next()
            .ok_or(CliTargetError::NotFound)
    }

    fn group_containing(
        &self,
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
    ) -> Option<GroupId> {
        let content = self.workspace.content(window_id, space_id)?;
        match content.location(ItemId::Tab(tab_id))? {
            Placement::Group { group_id, .. } => Some(group_id),
            Placement::Root(_) => None,
        }
    }
}

fn compact(id: Uuid) -> String {
    id.simple().to_string()
}
