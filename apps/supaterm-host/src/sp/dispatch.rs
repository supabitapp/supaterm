use super::arguments::{
    AgentCommand, Command, ConfigCommand, GroupCommand, LicenseCommand, PaneCommand, PaneDirection,
    PaneKey, PaneLayout, SkillsCommand, SpaceCommand, TabCommand, WindowCommand,
};
use super::target::parse_target;
use crate::agent::manifest::DetectionCatalog;
use crate::client::HostClient;
use crate::host::cli::{
    CliAction, CliExecuteRequest, CliNavigation, CliPaneLayout, CliTarget, CliTargetKind,
};
use crate::protocol::terminal::PaneId;
use crate::runtime::{PathConfiguration, RuntimePaths};
use crate::terminal::actor::Viewport;
use crate::workspace::model::{SplitDirection, SplitPlacement};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::io::{IsTerminal, Read};
use std::time::{Duration, Instant};

pub struct DispatchResult {
    pub value: Value,
    pub presentation: Presentation,
}

pub enum Presentation {
    Json,
    Tree,
    Text(String),
    Quiet,
}

pub async fn dispatch(
    client: &HostClient,
    command: Command,
    expected_structure_revision: Option<u64>,
) -> Result<DispatchResult> {
    match command {
        Command::Tree => {
            cli(
                client,
                expected_structure_revision,
                CliAction::Tree,
                Presentation::Tree,
            )
            .await
        }
        Command::Snapshot => {
            cli(
                client,
                expected_structure_revision,
                CliAction::Tree,
                Presentation::Json,
            )
            .await
        }
        Command::Diagnostic => {
            cli(
                client,
                expected_structure_revision,
                CliAction::Diagnostic,
                Presentation::Json,
            )
            .await
        }
        Command::Onboard => onboard(client).await,
        Command::Window { command } => {
            let action = match command {
                WindowCommand::New => CliAction::WindowNew,
                WindowCommand::Close { target, force } => CliAction::WindowClose {
                    target: parse_target(target.as_deref(), CliTargetKind::Window)?,
                    force,
                },
            };
            cli(
                client,
                expected_structure_revision,
                action,
                Presentation::Json,
            )
            .await
        }
        Command::Space { command } => {
            let action = match command {
                SpaceCommand::Ls => CliAction::SpaceList,
                SpaceCommand::New { name, color } => CliAction::SpaceNew { name, color },
                SpaceCommand::Focus { target } => CliAction::SpaceSelect {
                    target: parse_target(target.as_deref(), CliTargetKind::Space)?,
                },
                SpaceCommand::Destroy { target, force } => CliAction::SpaceClose {
                    target: parse_target(target.as_deref(), CliTargetKind::Space)?,
                    force,
                },
                SpaceCommand::Rename { name, target } => CliAction::SpaceRename {
                    target: parse_target(target.as_deref(), CliTargetKind::Space)?,
                    name,
                },
                SpaceCommand::Color { color, target } => CliAction::SpaceColor {
                    target: parse_target(target.as_deref(), CliTargetKind::Space)?,
                    color,
                },
                SpaceCommand::Move { index, target } => CliAction::SpaceMove {
                    target: parse_target(target.as_deref(), CliTargetKind::Space)?,
                    index,
                },
                SpaceCommand::Next => CliAction::SpaceNavigate {
                    direction: CliNavigation::Next,
                },
                SpaceCommand::Prev => CliAction::SpaceNavigate {
                    direction: CliNavigation::Previous,
                },
                SpaceCommand::Last => CliAction::SpaceNavigate {
                    direction: CliNavigation::Last,
                },
            };
            cli(
                client,
                expected_structure_revision,
                action,
                Presentation::Json,
            )
            .await
        }
        Command::Group { command } => {
            let action = group_action(command)?;
            cli(
                client,
                expected_structure_revision,
                action,
                Presentation::Json,
            )
            .await
        }
        Command::Tab { command } => {
            let (action, presentation) = tab_action(command)?;
            cli(client, expected_structure_revision, action, presentation).await
        }
        Command::Pane { command } => pane(client, command, expected_structure_revision).await,
        Command::Config { command } => config(client, command, expected_structure_revision).await,
        Command::Skills { command } => skills(client, command).await,
        Command::Agent { command } => agent(client, command).await,
        Command::License { command } => license(client, command).await,
        Command::Version | Command::Ssh { .. } => bail!("command does not use the host dispatcher"),
    }
}

fn group_action(command: GroupCommand) -> Result<CliAction> {
    Ok(match command {
        GroupCommand::New {
            name,
            space,
            tabs,
            color,
        } => {
            let tab_targets = if tabs.is_empty() {
                let _ = parse_target(space.as_deref(), CliTargetKind::Space)?;
                Vec::new()
            } else {
                tabs.iter()
                    .map(|target| parse_target(Some(target), CliTargetKind::Tab))
                    .collect::<Result<Vec<_>>>()?
            };
            CliAction::GroupNew {
                tab_targets,
                name,
                color,
            }
        }
        GroupCommand::Rename { name, target } => CliAction::GroupRename {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            name,
        },
        GroupCommand::Color { color, target } => CliAction::GroupColor {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            color,
        },
        GroupCommand::Pin { target } => CliAction::GroupPin {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            pinned: true,
        },
        GroupCommand::Unpin { target } => CliAction::GroupPin {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            pinned: false,
        },
        GroupCommand::Collapse { target } => CliAction::GroupCollapse {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            collapsed: true,
        },
        GroupCommand::Expand { target } => CliAction::GroupCollapse {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            collapsed: false,
        },
        GroupCommand::Move {
            destination_space,
            target,
            index,
            pinned,
        } => CliAction::GroupMove {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            destination_space: parse_target(Some(&destination_space), CliTargetKind::Space)?,
            index,
            pinned,
        },
        GroupCommand::Ungroup { target } => CliAction::GroupUngroup {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
        },
        GroupCommand::Close { target, force } => CliAction::GroupClose {
            target: parse_target(target.as_deref(), CliTargetKind::Group)?,
            force,
        },
    })
}

fn tab_action(command: TabCommand) -> Result<(CliAction, Presentation)> {
    let (action, presentation) = match command {
        TabCommand::New {
            space,
            title,
            cwd,
            pinned,
            script,
            argv,
        } => (
            CliAction::TabNew {
                space: parse_target(space.as_deref(), CliTargetKind::Space)?,
                title,
                cwd,
                pinned,
                script,
                argv,
            },
            Presentation::Json,
        ),
        TabCommand::Focus { target } => (
            CliAction::TabSelect {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
            },
            Presentation::Json,
        ),
        TabCommand::Close { target, force } => (
            CliAction::TabClose {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
                force,
            },
            Presentation::Json,
        ),
        TabCommand::Rename { title, target } => (
            CliAction::TabRename {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
                title: (!title.is_empty()).then_some(title),
            },
            Presentation::Json,
        ),
        TabCommand::Title { target } => (
            CliAction::TabTitle {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
            },
            Presentation::Text("title".into()),
        ),
        TabCommand::Pin { target } => (
            CliAction::TabPin {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
                pinned: true,
            },
            Presentation::Json,
        ),
        TabCommand::Unpin { target } => (
            CliAction::TabPin {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
                pinned: false,
            },
            Presentation::Json,
        ),
        TabCommand::Move {
            destination_space,
            target,
            group,
            index,
            pinned,
        } => (
            CliAction::TabMove {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
                destination_space: parse_target(Some(&destination_space), CliTargetKind::Space)?,
                destination_group: group
                    .as_deref()
                    .map(|target| parse_target(Some(target), CliTargetKind::Group))
                    .transpose()?,
                index,
                pinned,
            },
            Presentation::Json,
        ),
        TabCommand::Next => (
            CliAction::TabNavigate {
                direction: CliNavigation::Next,
            },
            Presentation::Json,
        ),
        TabCommand::Prev => (
            CliAction::TabNavigate {
                direction: CliNavigation::Previous,
            },
            Presentation::Json,
        ),
        TabCommand::Last => (
            CliAction::TabNavigate {
                direction: CliNavigation::Last,
            },
            Presentation::Json,
        ),
    };
    Ok((action, presentation))
}

async fn pane(
    client: &HostClient,
    command: PaneCommand,
    expected_structure_revision: Option<u64>,
) -> Result<DispatchResult> {
    let (action, presentation) = match command {
        PaneCommand::Split {
            direction,
            target,
            cwd,
            script,
            argv,
        } => {
            let (direction, placement) = split(direction);
            (
                CliAction::PaneSplit {
                    target: parse_container(target.as_deref())?,
                    direction,
                    placement,
                    cwd,
                    script,
                    argv,
                },
                Presentation::Json,
            )
        }
        PaneCommand::Focus { target } => (
            CliAction::PaneFocus {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
            },
            Presentation::Json,
        ),
        PaneCommand::Close { target, force } => (
            CliAction::PaneClose {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                force,
            },
            Presentation::Json,
        ),
        PaneCommand::MoveToNewTab {
            target,
            destination_space,
            index,
            pinned,
        } => (
            CliAction::PaneMoveToNewTab {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                destination_space: parse_target(
                    destination_space.as_deref(),
                    CliTargetKind::Space,
                )?,
                index,
                pinned,
            },
            Presentation::Json,
        ),
        PaneCommand::MoveToTab {
            destination_tab,
            target_pane,
            target,
            direction,
        } => {
            let (direction, placement) = split(direction);
            (
                CliAction::PaneMoveToTab {
                    target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                    destination_tab: parse_target(Some(&destination_tab), CliTargetKind::Tab)?,
                    target_pane: parse_target(Some(&target_pane), CliTargetKind::Pane)?,
                    direction,
                    placement,
                },
                Presentation::Json,
            )
        }
        PaneCommand::Capture { target, lines } => {
            let result = cli(
                client,
                expected_structure_revision,
                CliAction::PaneCapture {
                    target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                },
                Presentation::Text("text".into()),
            )
            .await?;
            return Ok(if let Some(lines) = lines {
                let text = result.value["text"].as_str().unwrap_or_default();
                let trimmed = text
                    .lines()
                    .rev()
                    .take(lines)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n");
                DispatchResult {
                    value: json!({"pane_id": result.value["pane_id"], "text": trimmed}),
                    presentation: Presentation::Text("text".into()),
                }
            } else {
                result
            });
        }
        PaneCommand::Health { target } => (
            CliAction::PaneHealth {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
            },
            Presentation::Json,
        ),
        PaneCommand::WaitReady { target, timeout } => {
            if timeout <= 0.0 {
                bail!("--timeout must be greater than zero");
            }
            let action = CliAction::PaneHealth {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
            };
            let deadline = Instant::now() + Duration::from_secs_f64(timeout);
            loop {
                let result = cli(
                    client,
                    expected_structure_revision,
                    action.clone(),
                    Presentation::Json,
                )
                .await?;
                if result.value["pane"]["lifecycle"] == "running" {
                    return Ok(result);
                }
                if Instant::now() >= deadline {
                    bail!("timed out waiting for pane readiness");
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        PaneCommand::Resize {
            target,
            rows,
            columns,
            pixel_width,
            pixel_height,
        } => (
            CliAction::PaneResize {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                viewport: Viewport {
                    rows,
                    columns,
                    pixel_width,
                    pixel_height,
                },
            },
            Presentation::Json,
        ),
        PaneCommand::Layout { layout, target } => (
            CliAction::PaneLayout {
                target: parse_target(target.as_deref(), CliTargetKind::Tab)?,
                layout: match layout {
                    PaneLayout::Tile => CliPaneLayout::Tile,
                    PaneLayout::MainVertical => CliPaneLayout::MainVertical,
                },
            },
            Presentation::Json,
        ),
        PaneCommand::Send {
            target,
            newline,
            submit,
            text,
        } => {
            if newline && submit {
                bail!("--newline and --submit cannot be used together");
            }
            let mut text = match text {
                Some(value) if value != "-" => value,
                _ => read_stdin()?,
            };
            if newline || submit {
                text.push('\r');
            }
            (
                CliAction::PaneInput {
                    target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                    bytes: text.into_bytes(),
                },
                Presentation::Quiet,
            )
        }
        PaneCommand::Key { key, target } => (
            CliAction::PaneInput {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                bytes: pane_key(key).to_vec(),
            },
            Presentation::Quiet,
        ),
        PaneCommand::Notify {
            target,
            title,
            body,
        } => (
            CliAction::Notify {
                target: parse_target(target.as_deref(), CliTargetKind::Pane)?,
                title,
                body,
            },
            Presentation::Quiet,
        ),
    };
    cli(client, expected_structure_revision, action, presentation).await
}

async fn config(
    client: &HostClient,
    command: ConfigCommand,
    expected_structure_revision: Option<u64>,
) -> Result<DispatchResult> {
    let (action, presentation) = match command {
        ConfigCommand::List | ConfigCommand::Validate => {
            (CliAction::SettingsList, Presentation::Json)
        }
        ConfigCommand::Get { key } => (
            CliAction::SettingsGet { key },
            Presentation::Text(String::new()),
        ),
        ConfigCommand::Set { key, value } => (
            CliAction::SettingsSet {
                key,
                value: serde_json::from_str(&value).unwrap_or(Value::String(value)),
            },
            Presentation::Json,
        ),
        ConfigCommand::Reset { key } => (CliAction::SettingsReset { key }, Presentation::Quiet),
        ConfigCommand::Path => {
            let path =
                RuntimePaths::initialize(PathConfiguration::from_environment()?)?.durable_state;
            return Ok(DispatchResult {
                value: json!({"path": path}),
                presentation: Presentation::Text("path".into()),
            });
        }
    };
    cli(client, expected_structure_revision, action, presentation).await
}

async fn skills(client: &HostClient, command: SkillsCommand) -> Result<DispatchResult> {
    let (method, params, presentation) = match command {
        SkillsCommand::List => ("skills.list", Value::Null, Presentation::Json),
        SkillsCommand::Get { name, full } => (
            "skills.get",
            json!({"name": name, "full": full}),
            Presentation::Text("content".into()),
        ),
        SkillsCommand::Path { name } => (
            "skills.path",
            json!({"name": name}),
            Presentation::Text("path".into()),
        ),
        SkillsCommand::Install => (
            "skills.install",
            Value::Null,
            Presentation::Text("path".into()),
        ),
    };
    direct(client, method, params, presentation).await
}

async fn agent(client: &HostClient, command: AgentCommand) -> Result<DispatchResult> {
    match command {
        AgentCommand::Receive { .. } => bail!("agent receive is handled before connecting"),
        AgentCommand::Reload => {
            let mut values = Vec::new();
            for manifest in DetectionCatalog::embedded()?.manifests() {
                values.push(
                    client
                        .request("integration.repair", json!({"kind": manifest.id}))
                        .await?,
                );
            }
            Ok(DispatchResult {
                value: Value::Array(values),
                presentation: Presentation::Json,
            })
        }
        AgentCommand::Setup { kind } => {
            direct(
                client,
                "integration.setup",
                json!({"kind": kind}),
                Presentation::Json,
            )
            .await
        }
        AgentCommand::Health { kind } => {
            direct(
                client,
                "integration.health",
                json!({"kind": kind}),
                Presentation::Json,
            )
            .await
        }
        AgentCommand::Repair { kind } => {
            direct(
                client,
                "integration.repair",
                json!({"kind": kind}),
                Presentation::Json,
            )
            .await
        }
        AgentCommand::Remove { kind } => {
            direct(
                client,
                "integration.remove",
                json!({"kind": kind}),
                Presentation::Json,
            )
            .await
        }
    }
}

async fn onboard(client: &HostClient) -> Result<DispatchResult> {
    let mut values = Vec::new();
    for manifest in DetectionCatalog::embedded()?.manifests() {
        values.push(
            client
                .request("integration.setup", json!({"kind": manifest.id}))
                .await?,
        );
    }
    values.push(client.request("skills.install", Value::Null).await?);
    Ok(DispatchResult {
        value: Value::Array(values),
        presentation: Presentation::Json,
    })
}

async fn license(client: &HostClient, command: Option<LicenseCommand>) -> Result<DispatchResult> {
    let (method, params, presentation) = match command.unwrap_or(LicenseCommand::Status) {
        LicenseCommand::Status => ("license.status", Value::Null, Presentation::Json),
        LicenseCommand::Activate => (
            "license.activate",
            json!({"key": read_license_key()?}),
            Presentation::Json,
        ),
        LicenseCommand::Deactivate => ("license.deactivate", Value::Null, Presentation::Json),
        LicenseCommand::Refresh => ("license.refresh", Value::Null, Presentation::Json),
        LicenseCommand::Buy => ("license.buy", Value::Null, Presentation::Text("url".into())),
        LicenseCommand::Renew => (
            "license.renew",
            Value::Null,
            Presentation::Text("url".into()),
        ),
    };
    direct(client, method, params, presentation).await
}

async fn cli(
    client: &HostClient,
    expected_structure_revision: Option<u64>,
    action: CliAction,
    presentation: Presentation,
) -> Result<DispatchResult> {
    let context_pane_id = std::env::var("SUPATERM_PANE_ID")
        .ok()
        .map(|value| value.parse::<Uuid>().map(PaneId))
        .transpose()
        .context("SUPATERM_PANE_ID is invalid")?;
    let value = client
        .request(
            "cli.execute",
            serde_json::to_value(CliExecuteRequest {
                context_pane_id,
                expected_structure_revision,
                action,
            })?,
        )
        .await?;
    Ok(DispatchResult {
        value,
        presentation,
    })
}

async fn direct(
    client: &HostClient,
    method: &str,
    params: Value,
    presentation: Presentation,
) -> Result<DispatchResult> {
    Ok(DispatchResult {
        value: client.request(method, params).await?,
        presentation,
    })
}

fn parse_container(value: Option<&str>) -> Result<CliTarget> {
    match parse_target(value, CliTargetKind::Pane) {
        Ok(target) => Ok(target),
        Err(_) => parse_target(value, CliTargetKind::Tab),
    }
}

fn split(direction: PaneDirection) -> (SplitDirection, SplitPlacement) {
    match direction {
        PaneDirection::Left => (SplitDirection::Horizontal, SplitPlacement::Before),
        PaneDirection::Right => (SplitDirection::Horizontal, SplitPlacement::After),
        PaneDirection::Up => (SplitDirection::Vertical, SplitPlacement::Before),
        PaneDirection::Down => (SplitDirection::Vertical, SplitPlacement::After),
    }
}

fn pane_key(key: PaneKey) -> &'static [u8] {
    match key {
        PaneKey::Enter => b"\r",
        PaneKey::Escape => b"\x1b",
        PaneKey::Tab => b"\t",
        PaneKey::Backspace => b"\x7f",
        PaneKey::CtrlC => b"\x03",
        PaneKey::CtrlD => b"\x04",
        PaneKey::CtrlL => b"\x0c",
        PaneKey::CtrlZ => b"\x1a",
    }
}

fn read_stdin() -> Result<String> {
    let mut value = String::new();
    std::io::stdin().read_to_string(&mut value)?;
    Ok(value)
}

fn read_license_key() -> Result<String> {
    if std::io::stdin().is_terminal() {
        bail!("pipe the license key to sp license activate")
    }
    let value = read_stdin()?.trim().to_owned();
    if value.is_empty() || value.len() > 4096 {
        bail!("invalid license key")
    }
    Ok(value)
}

use uuid::Uuid;
