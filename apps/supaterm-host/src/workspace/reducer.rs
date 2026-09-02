use crate::protocol::control::ClientId;
use crate::protocol::terminal::PaneId;
use crate::workspace::model::{
    ClientSpaceState, ClientState, ClientWindowState, Group, GroupId, GroupLifetime, ItemId,
    Placement, RootPlacement, Space, SpaceContent, SpaceId, SplitDirection, SplitId, SplitNode,
    SplitPlacement, Tab, TabId, ValidationError, Window, WindowId, Workspace,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    AddSpace {
        space_id: SpaceId,
        name: String,
        color: String,
    },
    DeleteSpace {
        space_id: SpaceId,
    },
    RenameSpace {
        space_id: SpaceId,
        name: String,
    },
    ReorderSpace {
        space_id: SpaceId,
        index: usize,
    },
    AddWindow {
        window_id: WindowId,
    },
    CloseWindow {
        window_id: WindowId,
    },
    CreateTab {
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
        pane_id: PaneId,
        placement: Placement,
        title: Option<String>,
        restart_directory: Option<PathBuf>,
    },
    CreateGroup {
        window_id: WindowId,
        space_id: SpaceId,
        group_id: GroupId,
        title: String,
        color: String,
        tab_ids: Vec<TabId>,
    },
    RenameGroup {
        group_id: GroupId,
        title: String,
    },
    MoveItems {
        source_window_id: WindowId,
        source_space_id: SpaceId,
        item_ids: Vec<ItemId>,
        destination_window_id: WindowId,
        destination_space_id: SpaceId,
        destination: Placement,
    },
    Ungroup {
        window_id: WindowId,
        space_id: SpaceId,
        group_id: GroupId,
    },
    CloseTab {
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
    },
    CloseGroup {
        window_id: WindowId,
        space_id: SpaceId,
        group_id: GroupId,
    },
    SplitPane {
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
        target_pane_id: PaneId,
        pane_id: PaneId,
        split_id: SplitId,
        direction: SplitDirection,
        placement: SplitPlacement,
        restart_directory: Option<PathBuf>,
    },
    ClosePane {
        pane_id: PaneId,
    },
    SetSplitRatio {
        split_id: SplitId,
        ratio: Ratio,
    },
    TileTab {
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
        split_ids: Vec<SplitId>,
    },
    MainVerticalTab {
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
        split_ids: Vec<SplitId>,
    },
    SelectSpace {
        client_id: ClientId,
        window_id: WindowId,
        space_id: SpaceId,
    },
    SelectTab {
        client_id: ClientId,
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
    },
    FocusPane {
        client_id: ClientId,
        window_id: WindowId,
        space_id: SpaceId,
        tab_id: TabId,
        pane_id: PaneId,
    },
    SetGroupCollapsed {
        client_id: ClientId,
        window_id: WindowId,
        space_id: SpaceId,
        group_id: GroupId,
        collapsed: bool,
    },
    DetachToWindow {
        source_window_id: WindowId,
        source_space_id: SpaceId,
        item_ids: Vec<ItemId>,
        window_id: WindowId,
    },
    MergeWindow {
        source_window_id: WindowId,
        destination_window_id: WindowId,
    },
}

pub type Ratio = f64;

impl Command {
    pub fn created_pane_id(&self) -> Option<PaneId> {
        match self {
            Self::CreateTab { pane_id, .. } | Self::SplitPane { pane_id, .. } => Some(*pane_id),
            _ => None,
        }
    }

    pub fn client_id(&self) -> Option<ClientId> {
        match self {
            Self::SelectSpace { client_id, .. }
            | Self::SelectTab { client_id, .. }
            | Self::FocusPane { client_id, .. }
            | Self::SetGroupCollapsed { client_id, .. } => Some(*client_id),
            _ => None,
        }
    }

    pub fn changes_structure(&self) -> bool {
        !matches!(
            self,
            Self::RenameSpace { .. }
                | Self::RenameGroup { .. }
                | Self::SelectSpace { .. }
                | Self::SelectTab { .. }
                | Self::FocusPane { .. }
                | Self::SetGroupCollapsed { .. }
        )
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReducerResult {
    pub focus_pane_id: Option<PaneId>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ReducerError {
    #[error("entity not found")]
    NotFound,
    #[error("entity already exists")]
    AlreadyExists,
    #[error("invalid name")]
    InvalidName,
    #[error("invalid placement")]
    InvalidPlacement,
    #[error("duplicate item")]
    DuplicateItem,
    #[error("cannot move a group with its child")]
    AncestorAndDescendant,
    #[error("cannot remove the last space or window")]
    LastContainer,
    #[error("split ratio must be between 0.05 and 0.95")]
    InvalidRatio,
    #[error("workspace invariant failed: {0}")]
    InvalidState(String),
}

impl From<ValidationError> for ReducerError {
    fn from(error: ValidationError) -> Self {
        Self::InvalidState(error.to_string())
    }
}

pub fn apply(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    command: Command,
) -> Result<ReducerResult, ReducerError> {
    let mut next_workspace = workspace.clone();
    let mut next_clients = clients.to_vec();
    let result = apply_inner(&mut next_workspace, &mut next_clients, command)?;
    repair_clients(&next_workspace, &mut next_clients);
    next_workspace.validate(&next_clients)?;
    *workspace = next_workspace;
    clients.clone_from_slice(&next_clients);
    Ok(result)
}

pub fn closing_pane_ids(
    workspace: &Workspace,
    command: &Command,
) -> Result<BTreeSet<PaneId>, ReducerError> {
    let panes = match command {
        Command::DeleteSpace { space_id } => workspace
            .windows
            .values()
            .filter_map(|window| window.spaces.get(space_id))
            .flat_map(|content| content.tabs.values())
            .flat_map(|tab| tab.root.leaves())
            .collect(),
        Command::CloseWindow { window_id } => workspace
            .windows
            .get(window_id)
            .ok_or(ReducerError::NotFound)?
            .spaces
            .values()
            .flat_map(|content| content.tabs.values())
            .flat_map(|tab| tab.root.leaves())
            .collect(),
        Command::CloseTab {
            window_id,
            space_id,
            tab_id,
        } => workspace
            .content(*window_id, *space_id)
            .and_then(|content| content.tabs.get(tab_id))
            .ok_or(ReducerError::NotFound)?
            .root
            .leaves()
            .into_iter()
            .collect(),
        Command::CloseGroup {
            window_id,
            space_id,
            group_id,
        } => {
            let content = workspace
                .content(*window_id, *space_id)
                .ok_or(ReducerError::NotFound)?;
            content
                .groups
                .get(group_id)
                .ok_or(ReducerError::NotFound)?
                .tabs
                .iter()
                .flat_map(|tab_id| content.tabs[tab_id].root.leaves())
                .collect()
        }
        Command::ClosePane { pane_id } => {
            if workspace.pane_ids().any(|candidate| candidate == *pane_id) {
                BTreeSet::from([*pane_id])
            } else {
                return Err(ReducerError::NotFound);
            }
        }
        _ => BTreeSet::new(),
    };
    Ok(panes)
}

fn apply_inner(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    command: Command,
) -> Result<ReducerResult, ReducerError> {
    match command {
        Command::AddSpace {
            space_id,
            name,
            color,
        } => add_space(workspace, clients, space_id, name, color)?,
        Command::DeleteSpace { space_id } => delete_space(workspace, clients, space_id)?,
        Command::RenameSpace { space_id, name } => {
            let name = normalized(name)?;
            workspace
                .spaces
                .iter_mut()
                .find(|space| space.id == space_id)
                .ok_or(ReducerError::NotFound)?
                .name = name;
        }
        Command::ReorderSpace { space_id, index } => {
            let source = workspace
                .spaces
                .iter()
                .position(|space| space.id == space_id)
                .ok_or(ReducerError::NotFound)?;
            let space = workspace.spaces.remove(source);
            let mut destination = index.min(workspace.spaces.len() + 1);
            if index > source {
                destination = destination.saturating_sub(1);
            }
            workspace
                .spaces
                .insert(destination.min(workspace.spaces.len()), space);
        }
        Command::AddWindow { window_id } => add_window(workspace, clients, window_id)?,
        Command::CloseWindow { window_id } => close_window(workspace, clients, window_id)?,
        Command::CreateTab {
            window_id,
            space_id,
            tab_id,
            pane_id,
            placement,
            title,
            restart_directory,
        } => create_tab(
            workspace,
            CreateTabInput {
                window_id,
                space_id,
                tab_id,
                pane_id,
                placement,
                title,
                restart_directory,
            },
        )?,
        Command::CreateGroup {
            window_id,
            space_id,
            group_id,
            title,
            color,
            tab_ids,
        } => create_group(
            workspace, window_id, space_id, group_id, title, color, tab_ids,
        )?,
        Command::RenameGroup { group_id, title } => {
            let title = normalized(title)?;
            find_group_mut(workspace, group_id)?.title = title;
        }
        Command::MoveItems {
            source_window_id,
            source_space_id,
            item_ids,
            destination_window_id,
            destination_space_id,
            destination,
        } => move_items(
            workspace,
            source_window_id,
            source_space_id,
            item_ids,
            destination_window_id,
            destination_space_id,
            destination,
        )?,
        Command::Ungroup {
            window_id,
            space_id,
            group_id,
        } => ungroup(workspace, window_id, space_id, group_id)?,
        Command::CloseTab {
            window_id,
            space_id,
            tab_id,
        } => close_tab(workspace, clients, window_id, space_id, tab_id)?,
        Command::CloseGroup {
            window_id,
            space_id,
            group_id,
        } => close_group(workspace, clients, window_id, space_id, group_id)?,
        Command::SplitPane {
            window_id,
            space_id,
            tab_id,
            target_pane_id,
            pane_id,
            split_id,
            direction,
            placement,
            restart_directory,
        } => split_pane(
            workspace,
            SplitPaneInput {
                window_id,
                space_id,
                tab_id,
                target_pane_id,
                pane_id,
                split_id,
                direction,
                placement,
                restart_directory,
            },
        )?,
        Command::ClosePane { pane_id } => {
            return close_pane(workspace, clients, pane_id);
        }
        Command::SetSplitRatio { split_id, ratio } => {
            if !(0.05..=0.95).contains(&ratio) || !ratio.is_finite() {
                return Err(ReducerError::InvalidRatio);
            }
            let node = find_split_mut(workspace, split_id)?;
            let SplitNode::Split {
                ratio_millionths, ..
            } = node
            else {
                return Err(ReducerError::NotFound);
            };
            *ratio_millionths = (ratio * 1_000_000.0).round() as u32;
        }
        Command::TileTab {
            window_id,
            space_id,
            tab_id,
            split_ids,
        } => layout_tab(
            workspace,
            window_id,
            space_id,
            tab_id,
            split_ids,
            Layout::Tiled,
        )?,
        Command::MainVerticalTab {
            window_id,
            space_id,
            tab_id,
            split_ids,
        } => layout_tab(
            workspace,
            window_id,
            space_id,
            tab_id,
            split_ids,
            Layout::MainVertical,
        )?,
        Command::SelectSpace {
            client_id,
            window_id,
            space_id,
        } => select_space(workspace, clients, client_id, window_id, space_id)?,
        Command::SelectTab {
            client_id,
            window_id,
            space_id,
            tab_id,
        } => select_tab(workspace, clients, client_id, window_id, space_id, tab_id)?,
        Command::FocusPane {
            client_id,
            window_id,
            space_id,
            tab_id,
            pane_id,
        } => focus_pane(
            workspace, clients, client_id, window_id, space_id, tab_id, pane_id,
        )?,
        Command::SetGroupCollapsed {
            client_id,
            window_id,
            space_id,
            group_id,
            collapsed,
        } => set_group_collapsed(
            workspace, clients, client_id, window_id, space_id, group_id, collapsed,
        )?,
        Command::DetachToWindow {
            source_window_id,
            source_space_id,
            item_ids,
            window_id,
        } => detach_to_window(
            workspace,
            clients,
            source_window_id,
            source_space_id,
            item_ids,
            window_id,
        )?,
        Command::MergeWindow {
            source_window_id,
            destination_window_id,
        } => merge_window(workspace, clients, source_window_id, destination_window_id)?,
    }
    Ok(ReducerResult::default())
}

fn add_space(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    space_id: SpaceId,
    name: String,
    color: String,
) -> Result<(), ReducerError> {
    if workspace.spaces.iter().any(|space| space.id == space_id) {
        return Err(ReducerError::AlreadyExists);
    }
    workspace.spaces.push(Space {
        id: space_id,
        name: normalized(name)?,
        color,
    });
    for window in workspace.windows.values_mut() {
        window.spaces.insert(space_id, SpaceContent::default());
    }
    for client in clients {
        for window in client.windows.values_mut() {
            window.spaces.insert(space_id, ClientSpaceState::default());
        }
    }
    Ok(())
}

fn delete_space(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    space_id: SpaceId,
) -> Result<(), ReducerError> {
    if workspace.spaces.len() == 1 {
        return Err(ReducerError::LastContainer);
    }
    let index = workspace
        .spaces
        .iter()
        .position(|space| space.id == space_id)
        .ok_or(ReducerError::NotFound)?;
    workspace.spaces.remove(index);
    let replacement = workspace.spaces[index.min(workspace.spaces.len() - 1)].id;
    for window in workspace.windows.values_mut() {
        window.spaces.remove(&space_id);
    }
    for client in clients {
        for window in client.windows.values_mut() {
            window.spaces.remove(&space_id);
            if window.displayed_space_id == space_id {
                window.displayed_space_id = replacement;
            }
        }
    }
    Ok(())
}

fn add_window(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    window_id: WindowId,
) -> Result<(), ReducerError> {
    if workspace.windows.contains_key(&window_id) {
        return Err(ReducerError::AlreadyExists);
    }
    let first_space = workspace.spaces[0].id;
    let spaces = workspace
        .spaces
        .iter()
        .map(|space| (space.id, SpaceContent::default()))
        .collect();
    workspace.windows.insert(
        window_id,
        Window {
            id: window_id,
            spaces,
        },
    );
    for client in clients {
        client.windows.insert(
            window_id,
            ClientWindowState {
                displayed_space_id: first_space,
                spaces: workspace
                    .spaces
                    .iter()
                    .map(|space| (space.id, ClientSpaceState::default()))
                    .collect(),
            },
        );
    }
    Ok(())
}

fn close_window(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    window_id: WindowId,
) -> Result<(), ReducerError> {
    if workspace.windows.len() == 1 {
        return Err(ReducerError::LastContainer);
    }
    workspace
        .windows
        .remove(&window_id)
        .ok_or(ReducerError::NotFound)?;
    for client in clients {
        client.windows.remove(&window_id);
    }
    Ok(())
}

struct CreateTabInput {
    window_id: WindowId,
    space_id: SpaceId,
    tab_id: TabId,
    pane_id: PaneId,
    placement: Placement,
    title: Option<String>,
    restart_directory: Option<PathBuf>,
}

fn create_tab(workspace: &mut Workspace, input: CreateTabInput) -> Result<(), ReducerError> {
    let CreateTabInput {
        window_id,
        space_id,
        tab_id,
        pane_id,
        placement,
        title,
        restart_directory,
    } = input;
    if workspace.tab(tab_id).is_some() || workspace.pane_ids().any(|id| id == pane_id) {
        return Err(ReducerError::AlreadyExists);
    }
    let content = workspace
        .content_mut(window_id, space_id)
        .ok_or(ReducerError::NotFound)?;
    insert_items(content, &[ItemId::Tab(tab_id)], placement)?;
    content.tabs.insert(
        tab_id,
        Tab {
            id: tab_id,
            title: title.and_then(|title| normalized(title).ok()),
            root: SplitNode::Pane {
                pane_id,
                restart_directory,
            },
        },
    );
    Ok(())
}

fn create_group(
    workspace: &mut Workspace,
    window_id: WindowId,
    space_id: SpaceId,
    group_id: GroupId,
    title: String,
    color: String,
    tab_ids: Vec<TabId>,
) -> Result<(), ReducerError> {
    let content = workspace
        .content_mut(window_id, space_id)
        .ok_or(ReducerError::NotFound)?;
    if content.groups.contains_key(&group_id) {
        return Err(ReducerError::AlreadyExists);
    }
    if tab_ids.iter().copied().collect::<BTreeSet<_>>().len() != tab_ids.len() {
        return Err(ReducerError::DuplicateItem);
    }
    if tab_ids
        .iter()
        .any(|tab_id| !content.tabs.contains_key(tab_id))
    {
        return Err(ReducerError::NotFound);
    }
    let anchor = tab_ids
        .first()
        .and_then(|tab_id| root_placement_containing(content, *tab_id))
        .unwrap_or(RootPlacement {
            pinned: false,
            index: content.regular_roots.len(),
        });
    let source_groups: BTreeSet<_> = tab_ids
        .iter()
        .filter_map(|tab_id| match content.location(ItemId::Tab(*tab_id)) {
            Some(Placement::Group { group_id, .. }) => Some(group_id),
            _ => None,
        })
        .collect();
    for tab_id in &tab_ids {
        remove_item(content, ItemId::Tab(*tab_id));
    }
    delete_empty_automatic_groups(content, &source_groups);
    let roots = if anchor.pinned {
        &mut content.pinned_roots
    } else {
        &mut content.regular_roots
    };
    roots.insert(anchor.index.min(roots.len()), ItemId::Group(group_id));
    content.groups.insert(
        group_id,
        Group {
            id: group_id,
            title: normalized(title)?,
            color,
            tabs: tab_ids.clone(),
            lifetime: if tab_ids.is_empty() {
                GroupLifetime::Durable
            } else {
                GroupLifetime::Automatic
            },
        },
    );
    Ok(())
}

#[derive(Default)]
struct Extracted {
    items: Vec<ItemId>,
    tabs: BTreeMap<TabId, Tab>,
    groups: BTreeMap<GroupId, Group>,
}

fn move_items(
    workspace: &mut Workspace,
    source_window_id: WindowId,
    source_space_id: SpaceId,
    item_ids: Vec<ItemId>,
    destination_window_id: WindowId,
    destination_space_id: SpaceId,
    destination: Placement,
) -> Result<(), ReducerError> {
    if item_ids.is_empty() {
        return Err(ReducerError::InvalidPlacement);
    }
    let source = workspace
        .content(source_window_id, source_space_id)
        .ok_or(ReducerError::NotFound)?;
    validate_move(source, &item_ids, destination)?;
    let same_content =
        source_window_id == destination_window_id && source_space_id == destination_space_id;
    let destination = if same_content {
        adjusted_destination(source, &item_ids, destination)
    } else {
        destination
    };
    let preserved_group = if same_content {
        match destination {
            Placement::Group { group_id, .. } => Some(group_id),
            Placement::Root(_) => None,
        }
    } else {
        None
    };
    let extracted = {
        let source = workspace
            .content_mut(source_window_id, source_space_id)
            .ok_or(ReducerError::NotFound)?;
        extract(source, &item_ids, preserved_group)?
    };
    let destination_content = workspace
        .content_mut(destination_window_id, destination_space_id)
        .ok_or(ReducerError::NotFound)?;
    insert_extracted(destination_content, extracted, destination)?;
    if source_window_id != destination_window_id
        && workspace.windows.len() > 1
        && workspace
            .windows
            .get(&source_window_id)
            .is_some_and(|window| {
                window
                    .spaces
                    .values()
                    .all(|content| content.tabs.is_empty())
            })
    {
        workspace.windows.remove(&source_window_id);
    }
    Ok(())
}

fn adjusted_destination(
    content: &SpaceContent,
    item_ids: &[ItemId],
    destination: Placement,
) -> Placement {
    let removed_before = match destination {
        Placement::Root(root) => {
            let roots = if root.pinned {
                &content.pinned_roots
            } else {
                &content.regular_roots
            };
            roots
                .iter()
                .take(root.index)
                .filter(|item| item_ids.contains(item))
                .count()
        }
        Placement::Group { group_id, index } => content
            .groups
            .get(&group_id)
            .map(|group| {
                group
                    .tabs
                    .iter()
                    .take(index)
                    .filter(|tab_id| item_ids.contains(&ItemId::Tab(**tab_id)))
                    .count()
            })
            .unwrap_or_default(),
    };
    match destination {
        Placement::Root(mut root) => {
            root.index -= removed_before;
            Placement::Root(root)
        }
        Placement::Group {
            group_id,
            mut index,
        } => {
            index -= removed_before;
            Placement::Group { group_id, index }
        }
    }
}

fn validate_move(
    content: &SpaceContent,
    item_ids: &[ItemId],
    destination: Placement,
) -> Result<(), ReducerError> {
    let requested: BTreeSet<_> = item_ids.iter().copied().collect();
    if requested.len() != item_ids.len() {
        return Err(ReducerError::DuplicateItem);
    }
    let groups: BTreeSet<_> = item_ids
        .iter()
        .filter_map(|item| match item {
            ItemId::Group(group_id) => Some(*group_id),
            ItemId::Tab(_) => None,
        })
        .collect();
    for item in item_ids {
        if content.location(*item).is_none() {
            return Err(ReducerError::NotFound);
        }
        if let ItemId::Tab(tab_id) = item
            && groups.iter().any(|group_id| {
                content
                    .groups
                    .get(group_id)
                    .is_some_and(|group| group.tabs.contains(tab_id))
            })
        {
            return Err(ReducerError::AncestorAndDescendant);
        }
    }
    match destination {
        Placement::Root(placement) => {
            let count = if placement.pinned {
                content.pinned_roots.len()
            } else {
                content.regular_roots.len()
            };
            if placement.index > count {
                return Err(ReducerError::InvalidPlacement);
            }
        }
        Placement::Group { group_id, index } => {
            let group = content
                .groups
                .get(&group_id)
                .ok_or(ReducerError::NotFound)?;
            if index > group.tabs.len()
                || item_ids.iter().any(|item| matches!(item, ItemId::Group(_)))
            {
                return Err(ReducerError::InvalidPlacement);
            }
        }
    }
    Ok(())
}

fn extract(
    content: &mut SpaceContent,
    item_ids: &[ItemId],
    preserved_group: Option<GroupId>,
) -> Result<Extracted, ReducerError> {
    let source_groups: BTreeSet<_> = item_ids
        .iter()
        .filter_map(|item| match item {
            ItemId::Tab(tab_id) => match content.location(ItemId::Tab(*tab_id)) {
                Some(Placement::Group { group_id, .. }) => Some(group_id),
                _ => None,
            },
            ItemId::Group(_) => None,
        })
        .collect();
    let mut extracted = Extracted {
        items: item_ids.to_vec(),
        ..Extracted::default()
    };
    for item in item_ids {
        remove_item(content, *item);
        match item {
            ItemId::Tab(tab_id) => {
                let tab = content.tabs.remove(tab_id).ok_or(ReducerError::NotFound)?;
                extracted.tabs.insert(*tab_id, tab);
            }
            ItemId::Group(group_id) => {
                let group = content
                    .groups
                    .remove(group_id)
                    .ok_or(ReducerError::NotFound)?;
                for tab_id in &group.tabs {
                    let tab = content.tabs.remove(tab_id).ok_or(ReducerError::NotFound)?;
                    extracted.tabs.insert(*tab_id, tab);
                }
                extracted.groups.insert(*group_id, group);
            }
        }
    }
    let source_groups = source_groups
        .into_iter()
        .filter(|group_id| Some(*group_id) != preserved_group)
        .collect();
    delete_empty_automatic_groups(content, &source_groups);
    Ok(extracted)
}

fn insert_extracted(
    content: &mut SpaceContent,
    extracted: Extracted,
    destination: Placement,
) -> Result<(), ReducerError> {
    if extracted
        .tabs
        .keys()
        .any(|tab_id| content.tabs.contains_key(tab_id))
        || extracted
            .groups
            .keys()
            .any(|group_id| content.groups.contains_key(group_id))
    {
        return Err(ReducerError::AlreadyExists);
    }
    insert_items(content, &extracted.items, destination)?;
    content.tabs.extend(extracted.tabs);
    content.groups.extend(extracted.groups);
    Ok(())
}

fn insert_items(
    content: &mut SpaceContent,
    items: &[ItemId],
    placement: Placement,
) -> Result<(), ReducerError> {
    match placement {
        Placement::Root(placement) => {
            let roots = if placement.pinned {
                &mut content.pinned_roots
            } else {
                &mut content.regular_roots
            };
            if placement.index > roots.len() {
                return Err(ReducerError::InvalidPlacement);
            }
            roots.splice(placement.index..placement.index, items.iter().copied());
        }
        Placement::Group { group_id, index } => {
            let group = content
                .groups
                .get_mut(&group_id)
                .ok_or(ReducerError::NotFound)?;
            if index > group.tabs.len() {
                return Err(ReducerError::InvalidPlacement);
            }
            let tabs: Option<Vec<_>> = items
                .iter()
                .map(|item| match item {
                    ItemId::Tab(tab_id) => Some(*tab_id),
                    ItemId::Group(_) => None,
                })
                .collect();
            let tabs = tabs.ok_or(ReducerError::InvalidPlacement)?;
            group.tabs.splice(index..index, tabs);
        }
    }
    Ok(())
}

fn ungroup(
    workspace: &mut Workspace,
    window_id: WindowId,
    space_id: SpaceId,
    group_id: GroupId,
) -> Result<(), ReducerError> {
    let content = workspace
        .content_mut(window_id, space_id)
        .ok_or(ReducerError::NotFound)?;
    let placement = match content.location(ItemId::Group(group_id)) {
        Some(Placement::Root(placement)) => placement,
        _ => return Err(ReducerError::NotFound),
    };
    let group = content
        .groups
        .remove(&group_id)
        .ok_or(ReducerError::NotFound)?;
    remove_item(content, ItemId::Group(group_id));
    insert_items(
        content,
        &group.tabs.into_iter().map(ItemId::Tab).collect::<Vec<_>>(),
        Placement::Root(placement),
    )
}

fn close_tab(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    window_id: WindowId,
    space_id: SpaceId,
    tab_id: TabId,
) -> Result<(), ReducerError> {
    let content = workspace
        .content_mut(window_id, space_id)
        .ok_or(ReducerError::NotFound)?;
    let order = content.flat_tabs();
    let index = order
        .iter()
        .position(|candidate| *candidate == tab_id)
        .ok_or(ReducerError::NotFound)?;
    let source_group = match content.location(ItemId::Tab(tab_id)) {
        Some(Placement::Group { group_id, .. }) => Some(group_id),
        Some(Placement::Root(_)) => None,
        None => return Err(ReducerError::NotFound),
    };
    remove_item(content, ItemId::Tab(tab_id));
    content.tabs.remove(&tab_id);
    if let Some(group_id) = source_group {
        delete_empty_automatic_groups(content, &BTreeSet::from([group_id]));
    }
    let remaining = content.flat_tabs();
    let replacement = remaining
        .get(index)
        .copied()
        .or_else(|| remaining.last().copied());
    for client in clients {
        if client.selected_tab(window_id, space_id) == Some(tab_id)
            && let Some(space) = client
                .windows
                .get_mut(&window_id)
                .and_then(|window| window.spaces.get_mut(&space_id))
        {
            space.selected_tab_id = replacement;
        }
    }
    Ok(())
}

fn close_group(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    window_id: WindowId,
    space_id: SpaceId,
    group_id: GroupId,
) -> Result<(), ReducerError> {
    let tab_ids = workspace
        .content(window_id, space_id)
        .and_then(|content| content.groups.get(&group_id))
        .ok_or(ReducerError::NotFound)?
        .tabs
        .clone();
    for tab_id in tab_ids {
        close_tab(workspace, clients, window_id, space_id, tab_id)?;
    }
    if let Some(content) = workspace.content_mut(window_id, space_id) {
        remove_item(content, ItemId::Group(group_id));
        content.groups.remove(&group_id);
    }
    Ok(())
}

struct SplitPaneInput {
    window_id: WindowId,
    space_id: SpaceId,
    tab_id: TabId,
    target_pane_id: PaneId,
    pane_id: PaneId,
    split_id: SplitId,
    direction: SplitDirection,
    placement: SplitPlacement,
    restart_directory: Option<PathBuf>,
}

fn split_pane(workspace: &mut Workspace, input: SplitPaneInput) -> Result<(), ReducerError> {
    let SplitPaneInput {
        window_id,
        space_id,
        tab_id,
        target_pane_id,
        pane_id,
        split_id,
        direction,
        placement,
        restart_directory,
    } = input;
    if workspace.pane_ids().any(|id| id == pane_id) || workspace.split(split_id).is_some() {
        return Err(ReducerError::AlreadyExists);
    }
    let tab = workspace
        .content_mut(window_id, space_id)
        .and_then(|content| content.tabs.get_mut(&tab_id))
        .ok_or(ReducerError::NotFound)?;
    let pane = SplitNode::Pane {
        pane_id,
        restart_directory,
    };
    if !insert_split(
        &mut tab.root,
        target_pane_id,
        pane,
        split_id,
        direction,
        placement,
    ) {
        return Err(ReducerError::NotFound);
    }
    Ok(())
}

fn insert_split(
    node: &mut SplitNode,
    target: PaneId,
    pane: SplitNode,
    split_id: SplitId,
    direction: SplitDirection,
    placement: SplitPlacement,
) -> bool {
    match node {
        SplitNode::Pane { pane_id, .. } if *pane_id == target => {
            let previous = node.clone();
            let (first, second) = match placement {
                SplitPlacement::Before => (pane, previous),
                SplitPlacement::After => (previous, pane),
            };
            *node = SplitNode::Split {
                split_id,
                direction,
                ratio_millionths: 500_000,
                first: Box::new(first),
                second: Box::new(second),
            };
            true
        }
        SplitNode::Pane { .. } => false,
        SplitNode::Split { first, second, .. } => {
            insert_split(first, target, pane.clone(), split_id, direction, placement)
                || insert_split(second, target, pane, split_id, direction, placement)
        }
    }
}

fn close_pane(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    pane_id: PaneId,
) -> Result<ReducerResult, ReducerError> {
    let location = workspace
        .windows
        .iter()
        .flat_map(|(window_id, window)| {
            window.spaces.iter().flat_map(move |(space_id, content)| {
                content.tabs.values().filter_map(move |tab| {
                    tab.root.contains_pane(pane_id).then_some((
                        *window_id,
                        *space_id,
                        tab.id,
                        tab.root.leaves(),
                    ))
                })
            })
        })
        .next()
        .ok_or(ReducerError::NotFound)?;
    let (window_id, space_id, tab_id, leaves) = location;
    if leaves.len() == 1 {
        close_tab(workspace, clients, window_id, space_id, tab_id)?;
        return Ok(ReducerResult::default());
    }
    let index = leaves
        .iter()
        .position(|candidate| *candidate == pane_id)
        .ok_or(ReducerError::NotFound)?;
    let focus = if index == 0 {
        leaves.get(1).copied()
    } else {
        leaves.get(index - 1).copied()
    };
    let tab = workspace
        .content_mut(window_id, space_id)
        .and_then(|content| content.tabs.get_mut(&tab_id))
        .ok_or(ReducerError::NotFound)?;
    tab.root = remove_pane(tab.root.clone(), pane_id).ok_or(ReducerError::NotFound)?;
    for client in clients {
        if let Some(space) = client
            .windows
            .get_mut(&window_id)
            .and_then(|window| window.spaces.get_mut(&space_id))
            && space.focused_panes.get(&tab_id) == Some(&pane_id)
        {
            if let Some(focus) = focus {
                space.focused_panes.insert(tab_id, focus);
            } else {
                space.focused_panes.remove(&tab_id);
            }
        }
    }
    Ok(ReducerResult {
        focus_pane_id: focus,
    })
}

fn remove_pane(node: SplitNode, pane_id: PaneId) -> Option<SplitNode> {
    match node {
        SplitNode::Pane {
            pane_id: candidate, ..
        } if candidate == pane_id => None,
        pane @ SplitNode::Pane { .. } => Some(pane),
        SplitNode::Split {
            split_id,
            direction,
            ratio_millionths,
            first,
            second,
        } => match (remove_pane(*first, pane_id), remove_pane(*second, pane_id)) {
            (Some(first), Some(second)) => Some(SplitNode::Split {
                split_id,
                direction,
                ratio_millionths,
                first: Box::new(first),
                second: Box::new(second),
            }),
            (Some(node), None) | (None, Some(node)) => Some(node),
            (None, None) => None,
        },
    }
}

#[derive(Clone, Copy)]
enum Layout {
    Tiled,
    MainVertical,
}

fn layout_tab(
    workspace: &mut Workspace,
    window_id: WindowId,
    space_id: SpaceId,
    tab_id: TabId,
    split_ids: Vec<SplitId>,
    layout: Layout,
) -> Result<(), ReducerError> {
    let tab = workspace
        .content(window_id, space_id)
        .and_then(|content| content.tabs.get(&tab_id))
        .ok_or(ReducerError::NotFound)?;
    let mut panes = Vec::new();
    append_pane_nodes(&tab.root, &mut panes);
    if split_ids.len() != panes.len().saturating_sub(1)
        || split_ids.iter().copied().collect::<BTreeSet<_>>().len() != split_ids.len()
    {
        return Err(ReducerError::InvalidPlacement);
    }
    let mut other_split_ids = BTreeSet::new();
    for candidate in workspace
        .windows
        .values()
        .flat_map(|window| window.spaces.values())
        .flat_map(|content| content.tabs.values())
        .filter(|candidate| candidate.id != tab_id)
    {
        append_split_ids(&candidate.root, &mut other_split_ids);
    }
    if split_ids.iter().any(|id| other_split_ids.contains(id)) {
        return Err(ReducerError::AlreadyExists);
    }
    let mut ids = split_ids.into_iter();
    let root = match layout {
        Layout::Tiled => build_balanced(panes, SplitDirection::Vertical, &mut ids)?,
        Layout::MainVertical if panes.len() > 1 => {
            let mut panes = panes;
            let teammates = panes.split_off(1);
            SplitNode::Split {
                split_id: ids.next().ok_or(ReducerError::InvalidPlacement)?,
                direction: SplitDirection::Horizontal,
                ratio_millionths: 500_000,
                first: Box::new(panes.remove(0)),
                second: Box::new(build_balanced(
                    teammates,
                    SplitDirection::Vertical,
                    &mut ids,
                )?),
            }
        }
        Layout::MainVertical => panes.into_iter().next().ok_or(ReducerError::NotFound)?,
    };
    workspace
        .content_mut(window_id, space_id)
        .and_then(|content| content.tabs.get_mut(&tab_id))
        .ok_or(ReducerError::NotFound)?
        .root = root;
    Ok(())
}

fn build_balanced(
    mut nodes: Vec<SplitNode>,
    direction: SplitDirection,
    ids: &mut impl Iterator<Item = SplitId>,
) -> Result<SplitNode, ReducerError> {
    if nodes.len() == 1 {
        return Ok(nodes.remove(0));
    }
    let second = nodes.split_off(nodes.len().div_ceil(2));
    Ok(SplitNode::Split {
        split_id: ids.next().ok_or(ReducerError::InvalidPlacement)?,
        direction,
        ratio_millionths: 500_000,
        first: Box::new(build_balanced(nodes, opposite(direction), ids)?),
        second: Box::new(build_balanced(second, opposite(direction), ids)?),
    })
}

fn opposite(direction: SplitDirection) -> SplitDirection {
    match direction {
        SplitDirection::Horizontal => SplitDirection::Vertical,
        SplitDirection::Vertical => SplitDirection::Horizontal,
    }
}

fn append_pane_nodes(node: &SplitNode, panes: &mut Vec<SplitNode>) {
    match node {
        pane @ SplitNode::Pane { .. } => panes.push(pane.clone()),
        SplitNode::Split { first, second, .. } => {
            append_pane_nodes(first, panes);
            append_pane_nodes(second, panes);
        }
    }
}

fn append_split_ids(node: &SplitNode, ids: &mut BTreeSet<SplitId>) {
    if let SplitNode::Split {
        split_id,
        first,
        second,
        ..
    } = node
    {
        ids.insert(*split_id);
        append_split_ids(first, ids);
        append_split_ids(second, ids);
    }
}

fn select_space(
    workspace: &Workspace,
    clients: &mut [ClientState],
    client_id: ClientId,
    window_id: WindowId,
    space_id: SpaceId,
) -> Result<(), ReducerError> {
    if workspace.content(window_id, space_id).is_none() {
        return Err(ReducerError::NotFound);
    }
    client_mut(clients, client_id)?
        .windows
        .get_mut(&window_id)
        .ok_or(ReducerError::NotFound)?
        .displayed_space_id = space_id;
    Ok(())
}

fn select_tab(
    workspace: &Workspace,
    clients: &mut [ClientState],
    client_id: ClientId,
    window_id: WindowId,
    space_id: SpaceId,
    tab_id: TabId,
) -> Result<(), ReducerError> {
    let content = workspace
        .content(window_id, space_id)
        .ok_or(ReducerError::NotFound)?;
    if !content.tabs.contains_key(&tab_id) {
        return Err(ReducerError::NotFound);
    }
    let state = client_mut(clients, client_id)?
        .windows
        .get_mut(&window_id)
        .and_then(|window| window.spaces.get_mut(&space_id))
        .ok_or(ReducerError::NotFound)?;
    state.selected_tab_id = Some(tab_id);
    if let Some(Placement::Group { group_id, .. }) = content.location(ItemId::Tab(tab_id)) {
        state.collapsed_group_ids.remove(&group_id);
    }
    Ok(())
}

fn focus_pane(
    workspace: &Workspace,
    clients: &mut [ClientState],
    client_id: ClientId,
    window_id: WindowId,
    space_id: SpaceId,
    tab_id: TabId,
    pane_id: PaneId,
) -> Result<(), ReducerError> {
    if !workspace
        .content(window_id, space_id)
        .and_then(|content| content.tabs.get(&tab_id))
        .is_some_and(|tab| tab.root.contains_pane(pane_id))
    {
        return Err(ReducerError::NotFound);
    }
    client_mut(clients, client_id)?
        .windows
        .get_mut(&window_id)
        .and_then(|window| window.spaces.get_mut(&space_id))
        .ok_or(ReducerError::NotFound)?
        .focused_panes
        .insert(tab_id, pane_id);
    Ok(())
}

fn set_group_collapsed(
    workspace: &Workspace,
    clients: &mut [ClientState],
    client_id: ClientId,
    window_id: WindowId,
    space_id: SpaceId,
    group_id: GroupId,
    collapsed: bool,
) -> Result<(), ReducerError> {
    if !workspace
        .content(window_id, space_id)
        .is_some_and(|content| content.groups.contains_key(&group_id))
    {
        return Err(ReducerError::NotFound);
    }
    let groups = &mut client_mut(clients, client_id)?
        .windows
        .get_mut(&window_id)
        .and_then(|window| window.spaces.get_mut(&space_id))
        .ok_or(ReducerError::NotFound)?
        .collapsed_group_ids;
    if collapsed {
        groups.insert(group_id);
    } else {
        groups.remove(&group_id);
    }
    Ok(())
}

fn detach_to_window(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    source_window_id: WindowId,
    source_space_id: SpaceId,
    item_ids: Vec<ItemId>,
    window_id: WindowId,
) -> Result<(), ReducerError> {
    let pinned = item_ids
        .first()
        .and_then(|item| {
            workspace
                .content(source_window_id, source_space_id)?
                .location(*item)
        })
        .and_then(|placement| match placement {
            Placement::Root(root) => Some(root.pinned),
            Placement::Group { group_id, .. } => workspace
                .content(source_window_id, source_space_id)?
                .location(ItemId::Group(group_id))
                .and_then(|placement| match placement {
                    Placement::Root(root) => Some(root.pinned),
                    Placement::Group { .. } => None,
                }),
        })
        .ok_or(ReducerError::NotFound)?;
    add_window(workspace, clients, window_id)?;
    move_items(
        workspace,
        source_window_id,
        source_space_id,
        item_ids,
        window_id,
        source_space_id,
        Placement::Root(RootPlacement { pinned, index: 0 }),
    )
}

fn merge_window(
    workspace: &mut Workspace,
    clients: &mut [ClientState],
    source_window_id: WindowId,
    destination_window_id: WindowId,
) -> Result<(), ReducerError> {
    if source_window_id == destination_window_id {
        return Err(ReducerError::InvalidPlacement);
    }
    let source = workspace
        .windows
        .get(&source_window_id)
        .cloned()
        .ok_or(ReducerError::NotFound)?;
    let space_ids: Vec<_> = workspace.spaces.iter().map(|space| space.id).collect();
    for space_id in space_ids {
        for pinned in [true, false] {
            let items = if pinned {
                source.spaces[&space_id].pinned_roots.clone()
            } else {
                source.spaces[&space_id].regular_roots.clone()
            };
            if items.is_empty() {
                continue;
            }
            let destination = workspace
                .content(destination_window_id, space_id)
                .ok_or(ReducerError::NotFound)?;
            let index = if pinned {
                destination.pinned_roots.len()
            } else {
                destination.regular_roots.len()
            };
            move_items(
                workspace,
                source_window_id,
                space_id,
                items,
                destination_window_id,
                space_id,
                Placement::Root(RootPlacement { pinned, index }),
            )?;
        }
    }
    if workspace.windows.contains_key(&source_window_id) {
        close_window(workspace, clients, source_window_id)
    } else {
        Ok(())
    }
}

fn root_placement_containing(content: &SpaceContent, tab_id: TabId) -> Option<RootPlacement> {
    match content.location(ItemId::Tab(tab_id))? {
        Placement::Root(placement) => Some(placement),
        Placement::Group { group_id, .. } => match content.location(ItemId::Group(group_id))? {
            Placement::Root(placement) => Some(placement),
            Placement::Group { .. } => None,
        },
    }
}

fn remove_item(content: &mut SpaceContent, item: ItemId) {
    content.pinned_roots.retain(|candidate| *candidate != item);
    content.regular_roots.retain(|candidate| *candidate != item);
    if let ItemId::Tab(tab_id) = item {
        for group in content.groups.values_mut() {
            group.tabs.retain(|candidate| *candidate != tab_id);
        }
    }
}

fn delete_empty_automatic_groups(content: &mut SpaceContent, groups: &BTreeSet<GroupId>) {
    for group_id in groups {
        if content.groups.get(group_id).is_some_and(|group| {
            group.lifetime == GroupLifetime::Automatic && group.tabs.is_empty()
        }) {
            remove_item(content, ItemId::Group(*group_id));
            content.groups.remove(group_id);
        }
    }
}

fn repair_clients(workspace: &Workspace, clients: &mut [ClientState]) {
    let valid_windows: BTreeSet<_> = workspace.windows.keys().copied().collect();
    let valid_spaces: BTreeSet<_> = workspace.spaces.iter().map(|space| space.id).collect();
    let first_space = workspace.spaces[0].id;
    for client in clients {
        client
            .windows
            .retain(|window_id, _| valid_windows.contains(window_id));
        for (window_id, window_state) in &mut client.windows {
            window_state
                .spaces
                .retain(|space_id, _| valid_spaces.contains(space_id));
            for space_id in &valid_spaces {
                window_state.spaces.entry(*space_id).or_default();
            }
            if !valid_spaces.contains(&window_state.displayed_space_id) {
                window_state.displayed_space_id = first_space;
            }
            for (space_id, space_state) in &mut window_state.spaces {
                let content = &workspace.windows[window_id].spaces[space_id];
                if space_state
                    .selected_tab_id
                    .is_some_and(|tab_id| !content.tabs.contains_key(&tab_id))
                {
                    space_state.selected_tab_id = content.flat_tabs().first().copied();
                }
                space_state
                    .collapsed_group_ids
                    .retain(|group_id| content.groups.contains_key(group_id));
                space_state.focused_panes.retain(|tab_id, pane_id| {
                    content
                        .tabs
                        .get(tab_id)
                        .is_some_and(|tab| tab.root.contains_pane(*pane_id))
                });
            }
        }
    }
}

fn find_group_mut(
    workspace: &mut Workspace,
    group_id: GroupId,
) -> Result<&mut Group, ReducerError> {
    workspace
        .windows
        .values_mut()
        .flat_map(|window| window.spaces.values_mut())
        .find_map(|content| content.groups.get_mut(&group_id))
        .ok_or(ReducerError::NotFound)
}

fn find_split_mut(
    workspace: &mut Workspace,
    split_id: SplitId,
) -> Result<&mut SplitNode, ReducerError> {
    workspace
        .windows
        .values_mut()
        .flat_map(|window| window.spaces.values_mut())
        .flat_map(|content| content.tabs.values_mut())
        .find_map(|tab| tab.root.find_split_mut(split_id))
        .ok_or(ReducerError::NotFound)
}

fn client_mut(
    clients: &mut [ClientState],
    client_id: ClientId,
) -> Result<&mut ClientState, ReducerError> {
    clients
        .iter_mut()
        .find(|client| client.id == client_id)
        .ok_or(ReducerError::NotFound)
}

fn normalized(value: String) -> Result<String, ReducerError> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        Err(ReducerError::InvalidName)
    } else {
        Ok(value)
    }
}
