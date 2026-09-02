use super::dispatch::{DispatchResult, Presentation};
use crate::workspace::model::{ItemId, SpaceContent, TabId};
use crate::workspace::replay::ModelSnapshot;
use anyhow::{Context, Result};
use serde_json::Value;
use uuid::Uuid;

pub fn emit(result: DispatchResult, json: bool, plain: bool, quiet: bool) -> Result<()> {
    if quiet || matches!(result.presentation, Presentation::Quiet) {
        return Ok(());
    }
    if json {
        println!("{}", serde_json::to_string(&result.value)?);
        return Ok(());
    }
    match result.presentation {
        Presentation::Tree if !plain => render_tree(result.value)?,
        Presentation::Text(key) => emit_text(&result.value, &key),
        Presentation::Tree | Presentation::Json => {
            if plain {
                emit_plain(&result.value);
            } else {
                println!("{}", serde_json::to_string_pretty(&result.value)?);
            }
        }
        Presentation::Quiet => {}
    }
    Ok(())
}

fn emit_text(value: &Value, key: &str) {
    let value = if key.is_empty() { value } else { &value[key] };
    match value {
        Value::Null => println!(),
        Value::String(value) => println!("{value}"),
        _ => println!("{value}"),
    }
}

fn emit_plain(value: &Value) {
    for key in [
        "pane_id",
        "tab_id",
        "group_id",
        "space_id",
        "window_id",
        "path",
    ] {
        if let Some(value) = value.get(key).and_then(Value::as_str) {
            println!("{value}");
            return;
        }
    }
    println!("{value}");
}

fn render_tree(value: Value) -> Result<()> {
    let snapshot: ModelSnapshot = serde_json::from_value(value)?;
    let client = snapshot
        .client_state
        .as_ref()
        .context("host omitted CLI client state")?;
    let ordered_windows = client.window_order.iter().enumerate();
    for (window_index, window_id) in ordered_windows {
        println!("window {} w:{}", window_index + 1, short(window_id.0));
        let window = &snapshot.workspace.windows[window_id];
        let client_window = &client.windows[window_id];
        for (space_index, space) in snapshot.workspace.spaces.iter().enumerate() {
            let selected = if client_window.displayed_space_id == space.id {
                "*"
            } else {
                " "
            };
            println!(
                "  {selected} space {} s:{} {}",
                space_index + 1,
                short(space.id.0),
                space.name
            );
            let content = &window.spaces[&space.id];
            let selected_tab = client_window.selected_tab_by_space.get(&space.id).copied();
            for item in content.roots() {
                match item {
                    ItemId::Group(group_id) => {
                        let group = &content.groups[&group_id];
                        println!("      group g:{} {}", short(group_id.0), group.title);
                        for tab_id in &group.tabs {
                            render_tab(content, *tab_id, selected_tab, client_window, 8);
                        }
                    }
                    ItemId::Tab(tab_id) => {
                        render_tab(content, tab_id, selected_tab, client_window, 6)
                    }
                }
            }
        }
    }
    Ok(())
}

fn render_tab(
    content: &SpaceContent,
    tab_id: TabId,
    selected_tab: Option<TabId>,
    client_window: &crate::workspace::model::ClientWindowState,
    indent: usize,
) {
    let tab = &content.tabs[&tab_id];
    let selected = if selected_tab == Some(tab_id) {
        "*"
    } else {
        " "
    };
    let title = tab.title.as_deref().unwrap_or("Terminal");
    println!(
        "{}{selected} tab t:{} {}",
        " ".repeat(indent),
        short(tab_id.0),
        title
    );
    let focused = client_window.focused_pane_by_tab.get(&tab_id).copied();
    for pane_id in tab.root.leaves() {
        let selected = if focused == Some(pane_id) { "*" } else { " " };
        println!(
            "{}{selected} pane p:{}",
            " ".repeat(indent + 2),
            short(pane_id.0)
        );
    }
}

fn short(id: Uuid) -> String {
    id.simple().to_string()[..8].to_owned()
}
