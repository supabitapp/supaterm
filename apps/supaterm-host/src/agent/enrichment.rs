use crate::agent::process::descendants;
use crate::protocol::terminal::PaneId;
use crate::workspace::runtime::{
    AgentEnrichment, CheckFact, CheckState, ListeningEndpoint, ProcessIdentity, ProcessTreeEntry,
    PullRequestFact, PullRequestKind, RepositoryFact,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;

const MAXIMUM_COMMAND_OUTPUT_BYTES: u64 = 4 * 1024 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn scan(
    pane_id: PaneId,
    source_process: ProcessIdentity,
    working_directory: Option<PathBuf>,
) -> AgentEnrichment {
    let process_tree = tokio::task::spawn_blocking({
        let source_process = source_process.clone();
        move || descendants(&source_process)
    })
    .await
    .unwrap_or_default();
    let listening_endpoints = listening_endpoints(&process_tree).await;
    let repository = match working_directory {
        Some(directory) => repository(&directory).await,
        None => None,
    };
    AgentEnrichment {
        pane_id,
        source_process,
        process_tree,
        listening_endpoints,
        repository,
        revision: 0,
    }
}

async fn repository(directory: &Path) -> Option<RepositoryFact> {
    let root = command_text(
        "/usr/bin/git",
        &["rev-parse", "--show-toplevel"],
        Some(directory),
    )
    .await
    .map(PathBuf::from)?;
    let branch = command_text("/usr/bin/git", &["branch", "--show-current"], Some(&root))
        .await
        .unwrap_or_default();
    let (added_lines, removed_lines) = command_text(
        "/usr/bin/git",
        &["diff", "--numstat", "HEAD", "--"],
        Some(&root),
    )
    .await
    .map_or((0, 0), |output| diff_counts(&output));
    let pull_request = pull_request(&root).await;
    Some(RepositoryFact {
        root,
        branch,
        added_lines,
        removed_lines,
        pull_request,
    })
}

async fn pull_request(root: &Path) -> Option<PullRequestFact> {
    let output = run(
        "/usr/bin/env",
        &[
            "gh",
            "pr",
            "view",
            "--json",
            "state,isDraft,title,url,additions,deletions,statusCheckRollup",
        ],
        Some(root),
    )
    .await?;
    let value: serde_json::Value = serde_json::from_slice(&output).ok()?;
    let state = value.get("state")?.as_str()?;
    let kind = if value.get("isDraft").and_then(serde_json::Value::as_bool) == Some(true) {
        PullRequestKind::Draft
    } else {
        match state {
            "OPEN" => PullRequestKind::Open,
            "MERGED" => PullRequestKind::Merged,
            "CLOSED" => PullRequestKind::Closed,
            _ => return None,
        }
    };
    let mut checks = value
        .get("statusCheckRollup")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(check)
        .collect::<Vec<_>>();
    checks.sort_by(|left, right| left.name.cmp(&right.name));
    Some(PullRequestFact {
        kind,
        title: value.get("title")?.as_str()?.to_owned(),
        url: value.get("url")?.as_str()?.to_owned(),
        added_lines: value.get("additions")?.as_u64()?,
        removed_lines: value.get("deletions")?.as_u64()?,
        checks,
    })
}

fn check(value: &serde_json::Value) -> Option<CheckFact> {
    let name = value
        .get("name")
        .or_else(|| value.get("context"))?
        .as_str()?
        .to_owned();
    let raw = value
        .get("conclusion")
        .or_else(|| value.get("state"))
        .or_else(|| value.get("status"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("PENDING");
    let state = match raw {
        "SUCCESS" | "NEUTRAL" => CheckState::Passing,
        "FAILURE" | "ERROR" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" => CheckState::Failing,
        "SKIPPED" | "STALE" => CheckState::Skipped,
        _ => CheckState::Pending,
    };
    let url = value
        .get("detailsUrl")
        .or_else(|| value.get("targetUrl"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    Some(CheckFact { name, state, url })
}

async fn listening_endpoints(processes: &[ProcessTreeEntry]) -> Vec<ListeningEndpoint> {
    if processes.is_empty() {
        return Vec::new();
    }
    let process_ids = processes
        .iter()
        .map(|process| process.identity.pid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let Some(output) = run(
        "/usr/sbin/lsof",
        &[
            "-nP",
            "-a",
            "-p",
            &process_ids,
            "-iTCP",
            "-sTCP:LISTEN",
            "-FpnP",
        ],
        None,
    )
    .await
    else {
        return Vec::new();
    };
    let identities = processes
        .iter()
        .map(|process| (process.identity.pid, process.identity.clone()))
        .collect::<BTreeMap<_, _>>();
    parse_endpoints(&String::from_utf8_lossy(&output), &identities)
}

fn parse_endpoints(
    output: &str,
    identities: &BTreeMap<u32, ProcessIdentity>,
) -> Vec<ListeningEndpoint> {
    let mut process_id = None;
    let mut protocol = None;
    let mut endpoints = BTreeSet::new();
    for line in output.lines() {
        let Some(prefix) = line.as_bytes().first().copied() else {
            continue;
        };
        let value = &line[1..];
        match prefix {
            b'p' => process_id = value.parse::<u32>().ok(),
            b'P' => protocol = Some(value.to_ascii_lowercase()),
            b'n' => {
                let Some(process_identity) = process_id.and_then(|pid| identities.get(&pid)) else {
                    continue;
                };
                let Some((bind_address, port)) = endpoint(value) else {
                    continue;
                };
                endpoints.insert((
                    port,
                    bind_address,
                    protocol.clone().unwrap_or_else(|| "tcp".into()),
                    process_identity.pid,
                ));
            }
            _ => {}
        }
    }
    endpoints
        .into_iter()
        .filter_map(|(port, bind_address, protocol, process_id)| {
            Some(ListeningEndpoint {
                port,
                bind_address,
                protocol,
                process_identity: identities.get(&process_id)?.clone(),
            })
        })
        .collect()
}

fn endpoint(value: &str) -> Option<(String, u16)> {
    let local = value.split("->").next()?;
    let separator = local.rfind(':')?;
    let port = local[separator + 1..]
        .parse()
        .ok()
        .filter(|port| *port > 0)?;
    let address = local[..separator].trim_matches(['[', ']']).to_owned();
    Some((address, port))
}

fn diff_counts(output: &str) -> (u64, u64) {
    output.lines().fold((0_u64, 0_u64), |counts, line| {
        let mut fields = line.split('\t');
        let added = fields
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let removed = fields
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        (
            counts.0.saturating_add(added),
            counts.1.saturating_add(removed),
        )
    })
}

async fn command_text(program: &str, arguments: &[&str], cwd: Option<&Path>) -> Option<String> {
    String::from_utf8(run(program, arguments, cwd).await?)
        .ok()
        .map(|value| value.trim().to_owned())
}

async fn run(program: &str, arguments: &[&str], cwd: Option<&Path>) -> Option<Vec<u8>> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?.take(MAXIMUM_COMMAND_OUTPUT_BYTES + 1);
    let result = tokio::time::timeout(COMMAND_TIMEOUT, async {
        let mut output = Vec::new();
        let read = stdout.read_to_end(&mut output).await;
        let status = child.wait().await;
        (read, status, output)
    })
    .await
    .ok()?;
    if result.0.is_err()
        || !matches!(result.1, Ok(status) if status.success())
        || result.2.len() as u64 > MAXIMUM_COMMAND_OUTPUT_BYTES
    {
        return None;
    }
    Some(result.2)
}
