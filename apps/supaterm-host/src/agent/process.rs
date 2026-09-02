use crate::agent::manifest::DetectionCatalog;
use crate::workspace::runtime::{ProcessIdentity, ProcessTreeEntry};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
#[cfg(target_os = "linux")]
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::process::Command;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessScan {
    pub identity: ProcessIdentity,
    pub parent_process_id: u32,
    pub arguments: Vec<String>,
    pub agent_kind: Option<String>,
}

pub fn scan_process_group(
    process_group_id: u32,
    catalog: &DetectionCatalog,
) -> Option<ProcessScan> {
    let table = process_table()?;
    let group: Vec<_> = table
        .values()
        .filter(|process| process.process_group_id == process_group_id)
        .collect();
    let recognized: Vec<_> = group
        .iter()
        .filter_map(|process| {
            let executable = process.executable.file_name()?.to_str()?;
            catalog
                .recognizes_executable(executable)
                .map(|kind| (*process, kind.to_owned()))
        })
        .collect();
    let (process, agent_kind) = if recognized
        .iter()
        .map(|(_, kind)| kind)
        .collect::<BTreeSet<_>>()
        .len()
        == 1
    {
        let (process, kind) = recognized
            .into_iter()
            .min_by_key(|(process, _)| (depth(process.process_id, &table), process.process_id))?;
        (process, Some(kind))
    } else {
        let process = group
            .iter()
            .find(|process| process.process_id == process_group_id)
            .or_else(|| group.iter().min_by_key(|process| process.process_id))?;
        (*process, None)
    };
    let identity = identity(
        process.process_id,
        process.process_group_id,
        &process.executable,
    )?;
    Some(ProcessScan {
        identity,
        parent_process_id: process.parent_process_id,
        arguments: arguments(process.process_id).unwrap_or_default(),
        agent_kind,
    })
}

pub fn is_descendant(mut process_id: u32, ancestor: &ProcessIdentity) -> bool {
    let Some(table) = process_table() else {
        return false;
    };
    let mut visited = BTreeSet::new();
    while visited.insert(process_id) {
        let Some(process) = table.get(&process_id) else {
            return false;
        };
        if process_id == ancestor.pid {
            return identity(process_id, process.process_group_id, &process.executable)
                .is_some_and(|identity| identity == *ancestor);
        }
        process_id = process.parent_process_id;
    }
    false
}

pub fn descendants(ancestor: &ProcessIdentity) -> Vec<ProcessTreeEntry> {
    let Some(table) = process_table() else {
        return Vec::new();
    };
    let Some(root) = table.get(&ancestor.pid) else {
        return Vec::new();
    };
    if identity(root.process_id, root.process_group_id, &root.executable).as_ref() != Some(ancestor)
    {
        return Vec::new();
    }
    let mut result = table
        .values()
        .filter(|process| descends_from(process.process_id, ancestor.pid, &table))
        .filter_map(|process| {
            Some(ProcessTreeEntry {
                identity: identity(
                    process.process_id,
                    process.process_group_id,
                    &process.executable,
                )?,
                parent_process_id: process.parent_process_id,
            })
        })
        .collect::<Vec<_>>();
    result.sort_by_key(|process| process.identity.pid);
    result
}

struct ProcessRecord {
    process_id: u32,
    parent_process_id: u32,
    process_group_id: u32,
    executable: PathBuf,
}

fn process_table() -> Option<BTreeMap<u32, ProcessRecord>> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,pgid="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let process_id = fields.next()?.parse().ok()?;
            let parent_process_id = fields.next()?.parse().ok()?;
            let process_group_id = fields.next()?.parse().ok()?;
            let executable = executable(process_id)?;
            Some((
                process_id,
                ProcessRecord {
                    process_id,
                    parent_process_id,
                    process_group_id,
                    executable,
                },
            ))
        })
        .collect::<BTreeMap<_, _>>()
        .into()
}

#[cfg(target_os = "linux")]
fn executable(process_id: u32) -> Option<PathBuf> {
    fs::read_link(format!("/proc/{process_id}/exe")).ok()
}

#[cfg(target_os = "macos")]
fn executable(process_id: u32) -> Option<PathBuf> {
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let count = unsafe {
        libc::proc_pidpath(
            process_id as i32,
            buffer.as_mut_ptr().cast(),
            u32::try_from(buffer.len()).ok()?,
        )
    };
    if count <= 0 {
        return None;
    }
    buffer.truncate(count as usize);
    Some(PathBuf::from(OsString::from_vec(buffer)))
}

#[cfg(target_os = "linux")]
fn start_identity(process_id: u32) -> Option<String> {
    let stat = fs::read_to_string(format!("/proc/{process_id}/stat")).ok()?;
    stat.rsplit_once(") ")?
        .1
        .split_whitespace()
        .nth(19)
        .map(str::to_owned)
}

#[cfg(target_os = "macos")]
fn start_identity(process_id: u32) -> Option<String> {
    let output = Command::new("/bin/ps")
        .args(["-o", "lstart=", "-p", &process_id.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8(output.stdout).ok()?.trim().to_owned())
}

fn identity(
    process_id: u32,
    process_group_id: u32,
    executable: &std::path::Path,
) -> Option<ProcessIdentity> {
    Some(ProcessIdentity {
        pid: process_id,
        start_identity: start_identity(process_id)?,
        foreground_process_group: process_group_id,
        executable: executable.to_owned(),
    })
}

#[cfg(target_os = "linux")]
fn arguments(process_id: u32) -> Option<Vec<String>> {
    let bytes = fs::read(format!("/proc/{process_id}/cmdline")).ok()?;
    Some(
        bytes
            .split(|byte| *byte == 0)
            .filter(|value| !value.is_empty())
            .map(|value| String::from_utf8_lossy(value).into_owned())
            .collect(),
    )
}

#[cfg(target_os = "macos")]
fn arguments(process_id: u32) -> Option<Vec<String>> {
    let output = Command::new("/bin/ps")
        .args(["-o", "command=", "-p", &process_id.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(vec![
        String::from_utf8(output.stdout).ok()?.trim().to_owned(),
    ])
}

fn depth(mut process_id: u32, table: &BTreeMap<u32, ProcessRecord>) -> usize {
    let mut visited = BTreeSet::new();
    let mut depth = 0;
    while visited.insert(process_id) {
        let Some(process) = table.get(&process_id) else {
            break;
        };
        process_id = process.parent_process_id;
        depth += 1;
    }
    depth
}

fn descends_from(
    mut process_id: u32,
    ancestor_process_id: u32,
    table: &BTreeMap<u32, ProcessRecord>,
) -> bool {
    let mut visited = BTreeSet::new();
    while visited.insert(process_id) {
        if process_id == ancestor_process_id {
            return true;
        }
        let Some(process) = table.get(&process_id) else {
            return false;
        };
        process_id = process.parent_process_id;
    }
    false
}
