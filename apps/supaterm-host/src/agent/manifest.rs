use fancy_regex::{Regex, RegexBuilder};
use include_dir::{Dir, include_dir};
use serde::Deserialize;
use std::collections::BTreeSet;
use thiserror::Error;

static MANIFEST_DIRECTORY: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../mac/supaterm/Resources/AgentDetection");
const MAXIMUM_MANIFEST_BYTES: usize = 1024 * 1024;
const MAXIMUM_RULES: usize = 512;
const MAXIMUM_REGEX_BYTES: usize = 16 * 1024;
const MAXIMUM_PREDICATE_DEPTH: usize = 8;
const MAXIMUM_SCREEN_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct DetectionCatalog {
    manifests: Vec<DetectionManifest>,
}

#[derive(Clone)]
pub struct DetectionManifest {
    pub id: String,
    pub version: String,
    pub integration: Option<IntegrationDescriptor>,
    rules: Vec<DetectionRule>,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntegrationDescriptor {
    pub settings_file: String,
    #[serde(default)]
    pub defaults: toml::Table,
    pub fork_arguments: Option<Vec<String>>,
}

#[derive(Clone)]
struct DetectionRule {
    id: String,
    state: String,
    priority: i64,
    region: Region,
    predicate: Predicate,
    skip_state_update: bool,
}

#[derive(Clone)]
enum Region {
    Title,
    Progress,
    Whole,
    TopNonEmpty(usize),
    BottomNonEmpty(usize),
    AfterHorizontalRule,
    AfterPromptMarker,
    PromptBoxBody,
}

#[derive(Clone, Default)]
struct Predicate {
    contains: Vec<String>,
    regexes: Vec<Regex>,
    line_regexes: Vec<Regex>,
    all: Vec<Predicate>,
    any: Vec<Predicate>,
    not: Vec<Predicate>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawManifest {
    id: String,
    version: String,
    integration: Option<IntegrationDescriptor>,
    #[serde(default)]
    rules: Vec<toml::Value>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DetectionMatch {
    pub rule_id: String,
    pub phase: String,
    pub skip_state_update: bool,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("manifest is not UTF-8")]
    InvalidUtf8,
    #[error("manifest exceeds one MiB")]
    TooLarge,
    #[error("invalid manifest: {0}")]
    Invalid(String),
}

impl DetectionCatalog {
    pub fn embedded() -> Result<Self, ManifestError> {
        let mut manifests = Vec::new();
        for file in MANIFEST_DIRECTORY.files() {
            if file
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                != Some("toml")
            {
                continue;
            }
            manifests.push(DetectionManifest::parse(file.contents())?);
        }
        manifests.sort_by(|left, right| left.id.cmp(&right.id));
        if manifests.is_empty()
            || manifests
                .iter()
                .map(|manifest| &manifest.id)
                .collect::<BTreeSet<_>>()
                .len()
                != manifests.len()
        {
            return Err(ManifestError::Invalid("invalid manifest catalog".into()));
        }
        Ok(Self { manifests })
    }

    pub fn manifests(&self) -> &[DetectionManifest] {
        &self.manifests
    }

    pub fn recognizes_executable(&self, executable: &str) -> Option<&str> {
        self.manifests.iter().find_map(|manifest| {
            (executable == manifest.id || executable.starts_with(&format!("{}-", manifest.id)))
                .then_some(manifest.id.as_str())
        })
    }

    pub fn has_kind(&self, kind: &str) -> bool {
        self.manifests.iter().any(|manifest| manifest.id == kind)
    }

    pub fn detect_title(&self, kind: &str, title: &str) -> Option<DetectionMatch> {
        self.detect(kind, title, |region| matches!(region, Region::Title))
    }

    pub fn detect_progress(&self, kind: &str, progress: &str) -> Option<DetectionMatch> {
        self.detect(kind, progress, |region| matches!(region, Region::Progress))
    }

    pub fn detect_screen(&self, kind: &str, screen: &str) -> Option<DetectionMatch> {
        if screen.len() > MAXIMUM_SCREEN_BYTES {
            return None;
        }
        self.detect(kind, screen, |region| region.requires_screen())
    }

    pub fn fork_command(&self, kind: &str, session_id: &str) -> Option<Vec<String>> {
        if session_id.is_empty()
            || session_id.len() > 1024
            || !session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return None;
        }
        let manifest = self.manifests.iter().find(|manifest| manifest.id == kind)?;
        let arguments = manifest.integration.as_ref()?.fork_arguments.as_ref()?;
        if arguments.len() > 16
            || arguments.iter().any(|argument| {
                argument.len() > 1024 || (argument != "{session_id}" && argument.contains('{'))
            })
        {
            return None;
        }
        Some(
            std::iter::once(manifest.id.clone())
                .chain(arguments.iter().map(|argument| {
                    if argument == "{session_id}" {
                        session_id.to_owned()
                    } else {
                        argument.clone()
                    }
                }))
                .collect(),
        )
    }

    fn detect(
        &self,
        kind: &str,
        source: &str,
        accepts: impl Fn(&Region) -> bool,
    ) -> Option<DetectionMatch> {
        self.manifests
            .iter()
            .find(|manifest| manifest.id == kind)?
            .rules
            .iter()
            .filter(|rule| accepts(&rule.region))
            .filter(|rule| rule.predicate.matches(&rule.region.select(source)))
            .max_by_key(|rule| rule.priority)
            .map(|rule| DetectionMatch {
                rule_id: rule.id.clone(),
                phase: rule.state.clone(),
                skip_state_update: rule.skip_state_update,
            })
    }
}

impl DetectionManifest {
    pub fn parse(bytes: &[u8]) -> Result<Self, ManifestError> {
        if bytes.len() > MAXIMUM_MANIFEST_BYTES {
            return Err(ManifestError::TooLarge);
        }
        let source = std::str::from_utf8(bytes).map_err(|_| ManifestError::InvalidUtf8)?;
        let raw: RawManifest =
            toml::from_str(source).map_err(|error| ManifestError::Invalid(error.to_string()))?;
        if raw.id.trim().is_empty()
            || raw.version.trim().is_empty()
            || raw.rules.len() > MAXIMUM_RULES
        {
            return Err(ManifestError::Invalid("invalid manifest header".into()));
        }
        let mut rule_ids = BTreeSet::new();
        let mut rules = Vec::new();
        for raw_rule in raw.rules {
            let table = raw_rule
                .as_table()
                .ok_or_else(|| ManifestError::Invalid("rule must be a table".into()))?;
            reject_unknown_keys(
                table,
                &[
                    "id",
                    "state",
                    "priority",
                    "region",
                    "contains",
                    "regex",
                    "line_regex",
                    "all",
                    "any",
                    "not",
                    "skip_state_update",
                    "visible_idle",
                ],
            )?;
            let id = string(table, "id")?;
            let state = string(table, "state")?;
            if !rule_ids.insert(id.clone())
                || !matches!(state.as_str(), "idle" | "working" | "blocked" | "unknown")
            {
                return Err(ManifestError::Invalid("invalid rule identity".into()));
            }
            let priority = table
                .get("priority")
                .and_then(toml::Value::as_integer)
                .unwrap_or_default();
            let region = Region::parse(
                table
                    .get("region")
                    .and_then(toml::Value::as_str)
                    .unwrap_or("whole_recent"),
            )?;
            let predicate = Predicate::parse(table, 0)?;
            if predicate.is_empty() {
                return Err(ManifestError::Invalid("empty predicate".into()));
            }
            rules.push(DetectionRule {
                id,
                state,
                priority,
                region,
                predicate,
                skip_state_update: boolean(table, "skip_state_update")?,
            });
        }
        Ok(Self {
            id: raw.id,
            version: raw.version,
            integration: raw.integration,
            rules,
        })
    }
}

impl Predicate {
    fn parse(
        table: &toml::map::Map<String, toml::Value>,
        depth: usize,
    ) -> Result<Self, ManifestError> {
        if depth >= MAXIMUM_PREDICATE_DEPTH {
            return Err(ManifestError::Invalid("predicate is too deep".into()));
        }
        Ok(Self {
            contains: strings(table.get("contains"))?,
            regexes: regexes(table.get("regex"))?,
            line_regexes: regexes(table.get("line_regex"))?,
            all: predicates(table.get("all"), depth + 1)?,
            any: predicates(table.get("any"), depth + 1)?,
            not: predicates(table.get("not"), depth + 1)?,
        })
    }

    fn is_empty(&self) -> bool {
        self.contains.is_empty()
            && self.regexes.is_empty()
            && self.line_regexes.is_empty()
            && self.all.is_empty()
            && self.any.is_empty()
            && self.not.is_empty()
    }

    fn matches(&self, source: &str) -> bool {
        self.contains.iter().all(|value| source.contains(value))
            && self.regexes.iter().all(|regex| matched(regex, source))
            && self
                .line_regexes
                .iter()
                .all(|regex| source.lines().any(|line| matched(regex, line)))
            && self.all.iter().all(|predicate| predicate.matches(source))
            && (self.any.is_empty() || self.any.iter().any(|predicate| predicate.matches(source)))
            && self.not.iter().all(|predicate| !predicate.matches(source))
    }
}

impl Region {
    fn parse(value: &str) -> Result<Self, ManifestError> {
        if value == "osc_title" {
            return Ok(Self::Title);
        }
        if value == "osc_progress" {
            return Ok(Self::Progress);
        }
        if value == "whole_recent" {
            return Ok(Self::Whole);
        }
        if value == "after_last_horizontal_rule" {
            return Ok(Self::AfterHorizontalRule);
        }
        if value == "after_last_prompt_marker" {
            return Ok(Self::AfterPromptMarker);
        }
        if value == "prompt_box_body" {
            return Ok(Self::PromptBoxBody);
        }
        if let Some(count) = bounded_region(value, "top_non_empty_lines(") {
            return Ok(Self::TopNonEmpty(count));
        }
        if let Some(count) = bounded_region(value, "bottom_non_empty_lines(") {
            return Ok(Self::BottomNonEmpty(count));
        }
        Err(ManifestError::Invalid("unknown region".into()))
    }

    fn select(&self, source: &str) -> String {
        match self {
            Self::Title | Self::Progress | Self::Whole => source.to_owned(),
            Self::TopNonEmpty(count) => non_empty(source)
                .take(*count)
                .collect::<Vec<_>>()
                .join("\n"),
            Self::BottomNonEmpty(count) => {
                let lines = non_empty(source).collect::<Vec<_>>();
                lines[lines.len().saturating_sub(*count)..].join("\n")
            }
            Self::PromptBoxBody => {
                let lines = non_empty(source).collect::<Vec<_>>();
                lines[lines.len().saturating_sub(12)..].join("\n")
            }
            Self::AfterHorizontalRule => after_last(source, horizontal_rule),
            Self::AfterPromptMarker => after_last(source, prompt_marker),
        }
    }

    fn requires_screen(&self) -> bool {
        !matches!(self, Self::Title | Self::Progress)
    }
}

fn bounded_region(value: &str, prefix: &str) -> Option<usize> {
    value
        .strip_prefix(prefix)?
        .strip_suffix(')')?
        .parse::<usize>()
        .ok()
        .filter(|count| (1..=256).contains(count))
}

fn non_empty(source: &str) -> impl Iterator<Item = &str> {
    source.lines().filter(|line| !line.trim().is_empty())
}

fn after_last(source: &str, predicate: impl Fn(&str) -> bool) -> String {
    let lines = source.lines().collect::<Vec<_>>();
    let start = lines
        .iter()
        .rposition(|line| predicate(line))
        .map_or(0, |index| index + 1);
    lines[start..].join("\n")
}

fn horizontal_rule(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.chars().count() >= 3
        && trimmed
            .chars()
            .all(|character| matches!(character, '-' | '─' | '━' | '═'))
}

fn prompt_marker(line: &str) -> bool {
    matches!(line.trim_start().chars().next(), Some('›' | '»' | '❯'))
}

fn string(table: &toml::map::Map<String, toml::Value>, key: &str) -> Result<String, ManifestError> {
    table
        .get(key)
        .and_then(toml::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| ManifestError::Invalid(format!("missing {key}")))
}

fn boolean(table: &toml::map::Map<String, toml::Value>, key: &str) -> Result<bool, ManifestError> {
    table
        .get(key)
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| ManifestError::Invalid(format!("invalid {key}")))
        })
        .transpose()
        .map(|value| value.unwrap_or(false))
}

fn strings(value: Option<&toml::Value>) -> Result<Vec<String>, ManifestError> {
    let Some(values) = value else {
        return Ok(Vec::new());
    };
    values
        .as_array()
        .ok_or_else(|| ManifestError::Invalid("expected string array".into()))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|value| !value.is_empty() && value.len() <= MAXIMUM_REGEX_BYTES)
                .map(str::to_owned)
                .ok_or_else(|| ManifestError::Invalid("invalid string".into()))
        })
        .collect()
}

fn regexes(value: Option<&toml::Value>) -> Result<Vec<Regex>, ManifestError> {
    strings(value)?
        .into_iter()
        .map(|source| {
            RegexBuilder::new(&source)
                .backtrack_limit(100_000)
                .build()
                .map_err(|error| ManifestError::Invalid(error.to_string()))
        })
        .collect()
}

fn predicates(value: Option<&toml::Value>, depth: usize) -> Result<Vec<Predicate>, ManifestError> {
    let Some(values) = value else {
        return Ok(Vec::new());
    };
    values
        .as_array()
        .ok_or_else(|| ManifestError::Invalid("expected predicate array".into()))?
        .iter()
        .map(|value| {
            let table = value
                .as_table()
                .ok_or_else(|| ManifestError::Invalid("expected predicate".into()))?;
            reject_unknown_keys(
                table,
                &["contains", "regex", "line_regex", "all", "any", "not"],
            )?;
            let predicate = Predicate::parse(table, depth)?;
            if predicate.is_empty() {
                return Err(ManifestError::Invalid("empty predicate".into()));
            }
            Ok(predicate)
        })
        .collect()
}

fn reject_unknown_keys(
    table: &toml::map::Map<String, toml::Value>,
    allowed: &[&str],
) -> Result<(), ManifestError> {
    if let Some(key) = table.keys().find(|key| !allowed.contains(&key.as_str())) {
        Err(ManifestError::Invalid(format!("unknown key {key}")))
    } else {
        Ok(())
    }
}

fn matched(regex: &Regex, source: &str) -> bool {
    regex.is_match(source).unwrap_or(false)
}
