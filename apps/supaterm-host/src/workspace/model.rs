use crate::protocol::control::ClientId;
use crate::protocol::terminal::PaneId;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

macro_rules! id {
    ($name:ident) => {
        #[derive(
            Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl Display for $name {
            fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
                Display::fmt(&self.0, formatter)
            }
        }
    };
}

id!(SpaceId);
id!(WindowId);
id!(GroupId);
id!(TabId);
id!(SplitId);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub spaces: Vec<Space>,
    pub windows: BTreeMap<WindowId, Window>,
}

impl Workspace {
    pub fn new(space_id: SpaceId, window_id: WindowId, name: String) -> Self {
        Self {
            spaces: vec![Space {
                id: space_id,
                name,
                color: "neutral".into(),
            }],
            windows: BTreeMap::from([(
                window_id,
                Window {
                    id: window_id,
                    spaces: BTreeMap::from([(space_id, SpaceContent::default())]),
                },
            )]),
        }
    }

    pub fn content(&self, window_id: WindowId, space_id: SpaceId) -> Option<&SpaceContent> {
        self.windows.get(&window_id)?.spaces.get(&space_id)
    }

    pub fn content_mut(
        &mut self,
        window_id: WindowId,
        space_id: SpaceId,
    ) -> Option<&mut SpaceContent> {
        self.windows.get_mut(&window_id)?.spaces.get_mut(&space_id)
    }

    pub fn tab(&self, tab_id: TabId) -> Option<&Tab> {
        self.windows
            .values()
            .flat_map(|window| window.spaces.values())
            .find_map(|space| space.tabs.get(&tab_id))
    }

    pub fn split(&self, split_id: SplitId) -> Option<&SplitNode> {
        self.windows
            .values()
            .flat_map(|window| window.spaces.values())
            .flat_map(|space| space.tabs.values())
            .find_map(|tab| tab.root.find_split(split_id))
    }

    pub fn pane_ids(&self) -> impl Iterator<Item = PaneId> + '_ {
        self.windows
            .values()
            .flat_map(|window| window.spaces.values())
            .flat_map(|space| space.tabs.values())
            .flat_map(|tab| tab.root.leaves())
    }

    pub fn restart_panes(&self) -> Vec<(PaneId, Option<PathBuf>)> {
        let mut panes = Vec::new();
        for tab in self
            .windows
            .values()
            .flat_map(|window| window.spaces.values())
            .flat_map(|space| space.tabs.values())
        {
            tab.root.append_restart_panes(&mut panes);
        }
        panes
    }

    pub fn validate(&self, clients: &[ClientState]) -> Result<(), ValidationError> {
        if self.spaces.is_empty() {
            return Err(ValidationError::Invalid("workspace has no spaces".into()));
        }
        if self.windows.is_empty() {
            return Err(ValidationError::Invalid("workspace has no windows".into()));
        }
        let mut space_ids = BTreeSet::new();
        for space in &self.spaces {
            if space.name.trim().is_empty() || !space_ids.insert(space.id) {
                return Err(ValidationError::Invalid("invalid space catalog".into()));
            }
        }
        let mut tab_ids = BTreeSet::new();
        let mut pane_ids = BTreeSet::new();
        let mut split_ids = BTreeSet::new();
        for (window_id, window) in &self.windows {
            if *window_id != window.id
                || window.spaces.keys().copied().collect::<BTreeSet<_>>() != space_ids
            {
                return Err(ValidationError::Invalid("invalid window space set".into()));
            }
            for content in window.spaces.values() {
                content.validate(&mut tab_ids, &mut pane_ids, &mut split_ids)?;
            }
        }
        let client_ids: BTreeSet<_> = clients.iter().map(|client| client.id).collect();
        if client_ids.len() != clients.len() {
            return Err(ValidationError::Invalid("duplicate client".into()));
        }
        for client in clients {
            client.validate(self)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Space {
    pub id: SpaceId,
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Window {
    pub id: WindowId,
    pub spaces: BTreeMap<SpaceId, SpaceContent>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceContent {
    pub pinned_roots: Vec<ItemId>,
    pub regular_roots: Vec<ItemId>,
    pub groups: BTreeMap<GroupId, Group>,
    pub tabs: BTreeMap<TabId, Tab>,
}

impl SpaceContent {
    pub fn roots(&self) -> impl Iterator<Item = ItemId> + '_ {
        self.pinned_roots.iter().chain(&self.regular_roots).copied()
    }

    pub fn flat_tabs(&self) -> Vec<TabId> {
        self.roots()
            .flat_map(|item| match item {
                ItemId::Tab(tab_id) => vec![tab_id],
                ItemId::Group(group_id) => self
                    .groups
                    .get(&group_id)
                    .map(|group| group.tabs.clone())
                    .unwrap_or_default(),
            })
            .collect()
    }

    pub fn location(&self, item: ItemId) -> Option<Placement> {
        if let Some(index) = self
            .pinned_roots
            .iter()
            .position(|candidate| *candidate == item)
        {
            return Some(Placement::Root(RootPlacement {
                pinned: true,
                index,
            }));
        }
        if let Some(index) = self
            .regular_roots
            .iter()
            .position(|candidate| *candidate == item)
        {
            return Some(Placement::Root(RootPlacement {
                pinned: false,
                index,
            }));
        }
        let ItemId::Tab(tab_id) = item else {
            return None;
        };
        self.groups.iter().find_map(|(group_id, group)| {
            group
                .tabs
                .iter()
                .position(|candidate| *candidate == tab_id)
                .map(|index| Placement::Group {
                    group_id: *group_id,
                    index,
                })
        })
    }

    fn validate(
        &self,
        global_tabs: &mut BTreeSet<TabId>,
        global_panes: &mut BTreeSet<PaneId>,
        global_splits: &mut BTreeSet<SplitId>,
    ) -> Result<(), ValidationError> {
        let mut roots = BTreeSet::new();
        for item in self.roots() {
            if !roots.insert(item) {
                return Err(ValidationError::Invalid("duplicate root item".into()));
            }
            match item {
                ItemId::Tab(tab_id) if !self.tabs.contains_key(&tab_id) => {
                    return Err(ValidationError::Invalid("root tab is missing".into()));
                }
                ItemId::Group(group_id) if !self.groups.contains_key(&group_id) => {
                    return Err(ValidationError::Invalid("root group is missing".into()));
                }
                _ => {}
            }
        }
        let root_groups: BTreeSet<_> = roots
            .iter()
            .filter_map(|item| match item {
                ItemId::Group(id) => Some(*id),
                ItemId::Tab(_) => None,
            })
            .collect();
        if root_groups != self.groups.keys().copied().collect() {
            return Err(ValidationError::Invalid("group is not a root".into()));
        }
        let mut placed_tabs = BTreeSet::new();
        for item in roots {
            if let ItemId::Tab(tab_id) = item
                && !placed_tabs.insert(tab_id)
            {
                return Err(ValidationError::Invalid("tab is placed twice".into()));
            }
        }
        for (group_id, group) in &self.groups {
            if *group_id != group.id
                || group.title.trim().is_empty()
                || group.lifetime == GroupLifetime::Automatic && group.tabs.is_empty()
            {
                return Err(ValidationError::Invalid("invalid group".into()));
            }
            for tab_id in &group.tabs {
                if !self.tabs.contains_key(tab_id) || !placed_tabs.insert(*tab_id) {
                    return Err(ValidationError::Invalid("invalid grouped tab".into()));
                }
            }
        }
        if placed_tabs != self.tabs.keys().copied().collect() {
            return Err(ValidationError::Invalid("unplaced tab".into()));
        }
        for (tab_id, tab) in &self.tabs {
            if *tab_id != tab.id || !global_tabs.insert(*tab_id) {
                return Err(ValidationError::Invalid("duplicate tab".into()));
            }
            tab.root.validate(global_panes, global_splits)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "type", content = "id", rename_all = "snake_case")]
pub enum ItemId {
    Tab(TabId),
    Group(GroupId),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Placement {
    Root(RootPlacement),
    Group { group_id: GroupId, index: usize },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RootPlacement {
    pub pinned: bool,
    pub index: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: GroupId,
    pub title: String,
    pub color: String,
    pub tabs: Vec<TabId>,
    pub lifetime: GroupLifetime,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupLifetime {
    Durable,
    Automatic,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tab {
    pub id: TabId,
    pub title: Option<String>,
    pub root: SplitNode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SplitNode {
    Pane {
        pane_id: PaneId,
        restart_directory: Option<PathBuf>,
    },
    Split {
        split_id: SplitId,
        direction: SplitDirection,
        ratio_millionths: u32,
        first: Box<SplitNode>,
        second: Box<SplitNode>,
    },
}

impl SplitNode {
    pub fn leaves(&self) -> Vec<PaneId> {
        let mut leaves = Vec::new();
        self.append_leaves(&mut leaves);
        leaves
    }

    pub fn ratio(&self) -> Option<f64> {
        match self {
            Self::Split {
                ratio_millionths, ..
            } => Some(f64::from(*ratio_millionths) / 1_000_000.0),
            Self::Pane { .. } => None,
        }
    }

    pub fn find_split(&self, id: SplitId) -> Option<&Self> {
        match self {
            Self::Pane { .. } => None,
            Self::Split {
                split_id,
                first,
                second,
                ..
            } => {
                if *split_id == id {
                    Some(self)
                } else {
                    first.find_split(id).or_else(|| second.find_split(id))
                }
            }
        }
    }

    pub(crate) fn find_split_mut(&mut self, id: SplitId) -> Option<&mut Self> {
        if matches!(self, Self::Split { split_id, .. } if *split_id == id) {
            return Some(self);
        }
        match self {
            Self::Pane { .. } => None,
            Self::Split { first, second, .. } => {
                if let Some(node) = first.find_split_mut(id) {
                    Some(node)
                } else {
                    second.find_split_mut(id)
                }
            }
        }
    }

    pub(crate) fn contains_pane(&self, id: PaneId) -> bool {
        match self {
            Self::Pane { pane_id, .. } => *pane_id == id,
            Self::Split { first, second, .. } => {
                first.contains_pane(id) || second.contains_pane(id)
            }
        }
    }

    pub(crate) fn find_pane(&self, id: PaneId) -> Option<&Self> {
        match self {
            Self::Pane { pane_id, .. } => (*pane_id == id).then_some(self),
            Self::Split { first, second, .. } => {
                first.find_pane(id).or_else(|| second.find_pane(id))
            }
        }
    }

    fn append_leaves(&self, leaves: &mut Vec<PaneId>) {
        match self {
            Self::Pane { pane_id, .. } => leaves.push(*pane_id),
            Self::Split { first, second, .. } => {
                first.append_leaves(leaves);
                second.append_leaves(leaves);
            }
        }
    }

    fn append_restart_panes(&self, panes: &mut Vec<(PaneId, Option<PathBuf>)>) {
        match self {
            Self::Pane {
                pane_id,
                restart_directory,
            } => panes.push((*pane_id, restart_directory.clone())),
            Self::Split { first, second, .. } => {
                first.append_restart_panes(panes);
                second.append_restart_panes(panes);
            }
        }
    }

    fn validate(
        &self,
        panes: &mut BTreeSet<PaneId>,
        splits: &mut BTreeSet<SplitId>,
    ) -> Result<(), ValidationError> {
        match self {
            Self::Pane { pane_id, .. } => {
                if !panes.insert(*pane_id) {
                    return Err(ValidationError::Invalid("duplicate pane".into()));
                }
            }
            Self::Split {
                split_id,
                ratio_millionths,
                first,
                second,
                ..
            } => {
                if !splits.insert(*split_id) || !(50_000..=950_000).contains(ratio_millionths) {
                    return Err(ValidationError::Invalid("invalid split".into()));
                }
                first.validate(panes, splits)?;
                second.validate(panes, splits)?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SplitPlacement {
    Before,
    After,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ClientState {
    pub id: ClientId,
    pub active_window_id: Option<WindowId>,
    pub window_order: Vec<WindowId>,
    pub windows: BTreeMap<WindowId, ClientWindowState>,
    pub seen_agent_revision_by_pane: BTreeMap<PaneId, u64>,
    pub seen_notification_revision_by_pane: BTreeMap<PaneId, u64>,
}

impl ClientState {
    pub fn new(id: ClientId, window_id: WindowId, space_id: SpaceId) -> Self {
        Self {
            id,
            active_window_id: Some(window_id),
            window_order: vec![window_id],
            windows: BTreeMap::from([(window_id, ClientWindowState::new(space_id))]),
            seen_agent_revision_by_pane: BTreeMap::new(),
            seen_notification_revision_by_pane: BTreeMap::new(),
        }
    }

    pub fn for_workspace(id: ClientId, workspace: &Workspace) -> Self {
        let first_space = workspace.spaces[0].id;
        let window_order: Vec<_> = workspace.windows.keys().copied().collect();
        let windows = window_order
            .iter()
            .map(|window_id| (*window_id, ClientWindowState::new(first_space)))
            .collect();
        Self {
            id,
            active_window_id: window_order.first().copied(),
            window_order,
            windows,
            seen_agent_revision_by_pane: BTreeMap::new(),
            seen_notification_revision_by_pane: BTreeMap::new(),
        }
    }

    pub fn selected_tab(&self, window_id: WindowId, space_id: SpaceId) -> Option<TabId> {
        self.windows
            .get(&window_id)?
            .selected_tab_by_space
            .get(&space_id)
            .copied()
    }

    fn validate(&self, workspace: &Workspace) -> Result<(), ValidationError> {
        let pane_ids: BTreeSet<_> = workspace.pane_ids().collect();
        if self
            .seen_agent_revision_by_pane
            .keys()
            .chain(self.seen_notification_revision_by_pane.keys())
            .any(|pane_id| !pane_ids.contains(pane_id))
        {
            return Err(ValidationError::Invalid(
                "client cursor references missing pane".into(),
            ));
        }
        let window_ids: BTreeSet<_> = workspace.windows.keys().copied().collect();
        if self.windows.keys().copied().collect::<BTreeSet<_>>() != window_ids
            || self.window_order.iter().copied().collect::<BTreeSet<_>>() != window_ids
            || self.window_order.len() != window_ids.len()
            || self.active_window_id.is_some_and(|window_id| {
                !self
                    .windows
                    .get(&window_id)
                    .is_some_and(|window| window.is_open)
            })
        {
            return Err(ValidationError::Invalid(
                "client window presentation is invalid".into(),
            ));
        }
        for (window_id, state) in &self.windows {
            let window = workspace.windows.get(window_id).ok_or_else(|| {
                ValidationError::Invalid("client references missing window".into())
            })?;
            if !window.spaces.contains_key(&state.displayed_space_id) {
                return Err(ValidationError::Invalid(
                    "client displays missing space".into(),
                ));
            }
            if state
                .previous_space_id
                .is_some_and(|space_id| !window.spaces.contains_key(&space_id))
                || state.sidebar_width == Some(0)
                || state
                    .platform_placement
                    .as_ref()
                    .is_some_and(|placement| !placement.is_valid())
            {
                return Err(ValidationError::Invalid(
                    "client window state is invalid".into(),
                ));
            }
            for tabs in [&state.selected_tab_by_space, &state.previous_tab_by_space] {
                for (space_id, tab_id) in tabs {
                    if !window
                        .spaces
                        .get(space_id)
                        .is_some_and(|content| content.tabs.contains_key(tab_id))
                    {
                        return Err(ValidationError::Invalid(
                            "client tab selection is invalid".into(),
                        ));
                    }
                }
            }
            for panes in [
                &state.focused_pane_by_tab,
                &state.previous_pane_by_tab,
                &state.zoomed_pane_by_tab,
            ] {
                for (tab_id, pane_id) in panes {
                    if !window.spaces.values().any(|content| {
                        content
                            .tabs
                            .get(tab_id)
                            .is_some_and(|tab| tab.root.contains_pane(*pane_id))
                    }) {
                        return Err(ValidationError::Invalid(
                            "client pane selection is invalid".into(),
                        ));
                    }
                }
            }
            for (space_id, groups) in &state.collapsed_groups_by_space {
                if !window.spaces.get(space_id).is_some_and(|content| {
                    groups
                        .iter()
                        .all(|group_id| content.groups.contains_key(group_id))
                }) {
                    return Err(ValidationError::Invalid(
                        "client collapsed groups are invalid".into(),
                    ));
                }
            }
            if state.hidden_agent_panels.iter().any(|pane_id| {
                !window
                    .spaces
                    .values()
                    .flat_map(|content| content.tabs.values())
                    .any(|tab| tab.root.contains_pane(*pane_id))
            }) {
                return Err(ValidationError::Invalid(
                    "client hidden agent panel is invalid".into(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ClientWindowState {
    pub is_open: bool,
    pub displayed_space_id: SpaceId,
    pub previous_space_id: Option<SpaceId>,
    pub selected_tab_by_space: BTreeMap<SpaceId, TabId>,
    pub previous_tab_by_space: BTreeMap<SpaceId, TabId>,
    pub focused_pane_by_tab: BTreeMap<TabId, PaneId>,
    pub previous_pane_by_tab: BTreeMap<TabId, PaneId>,
    pub zoomed_pane_by_tab: BTreeMap<TabId, PaneId>,
    pub collapsed_groups_by_space: BTreeMap<SpaceId, BTreeSet<GroupId>>,
    pub sidebar_collapsed: bool,
    pub sidebar_width: Option<u16>,
    pub hidden_agent_panels: BTreeSet<PaneId>,
    pub platform_placement: Option<PlatformWindowPlacement>,
}

impl ClientWindowState {
    pub fn new(space_id: SpaceId) -> Self {
        Self {
            is_open: true,
            displayed_space_id: space_id,
            previous_space_id: None,
            selected_tab_by_space: BTreeMap::new(),
            previous_tab_by_space: BTreeMap::new(),
            focused_pane_by_tab: BTreeMap::new(),
            previous_pane_by_tab: BTreeMap::new(),
            zoomed_pane_by_tab: BTreeMap::new(),
            collapsed_groups_by_space: BTreeMap::new(),
            sidebar_collapsed: false,
            sidebar_width: None,
            hidden_agent_panels: BTreeSet::new(),
            platform_placement: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformWindowPlacement {
    pub platform: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub display_id: Option<String>,
}

impl PlatformWindowPlacement {
    fn is_valid(&self) -> bool {
        !self.platform.trim().is_empty() && self.width > 0 && self.height > 0
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ValidationError {
    #[error("{0}")]
    Invalid(String),
}
