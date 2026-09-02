use include_dir::{Dir, DirEntry, include_dir};
use serde::Serialize;
use std::fs;
use std::io;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

static INTEGRATION_DIRECTORY: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../integrations/supaterm");

#[derive(Clone)]
pub struct SkillCatalog;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SkillFile {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SkillContent {
    pub name: String,
    pub content: String,
    pub files: Option<Vec<SkillFile>>,
}

#[derive(Debug, Error)]
pub enum SkillError {
    #[error("skill not found")]
    NotFound,
    #[error("invalid embedded skill: {0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl SkillCatalog {
    pub fn list(&self) -> Result<Vec<SkillSummary>, SkillError> {
        let directory = skill_data()?;
        let mut summaries = directory
            .dirs()
            .filter_map(|directory| self.summary(directory).transpose())
            .collect::<Result<Vec<_>, _>>()?;
        summaries.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(summaries)
    }

    pub fn get(&self, name: &str, full: bool) -> Result<SkillContent, SkillError> {
        let directory = self.directory(name)?;
        let summary = self.summary(directory)?.ok_or(SkillError::NotFound)?;
        let definition = utf8_file(directory, "SKILL.md")?;
        let files = full.then(|| {
            let mut files = Vec::new();
            collect_files(directory, Path::new(""), &mut files)?;
            files.retain(|file| file.path != "SKILL.md");
            files.sort_by(|left, right| left.path.cmp(&right.path));
            Ok::<_, SkillError>(files)
        });
        Ok(SkillContent {
            name: summary.name,
            content: definition,
            files: files.transpose()?,
        })
    }

    pub fn materialize(&self, state_root: &Path) -> Result<PathBuf, SkillError> {
        let destination = state_root
            .join("skill-data")
            .join(env!("SUPATERM_HOST_EMBEDDED_FINGERPRINT"));
        if destination.is_dir() {
            return Ok(destination);
        }
        let parent = destination.parent().ok_or(SkillError::NotFound)?;
        fs::create_dir_all(parent)?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        let temporary = parent.join(format!(".tmp-{}", Uuid::new_v4()));
        write_directory(skill_data()?, &temporary)?;
        match fs::rename(&temporary, &destination) {
            Ok(()) => {}
            Err(error) if destination.is_dir() => {
                fs::remove_dir_all(&temporary)?;
                let _ = error;
            }
            Err(error) => return Err(error.into()),
        }
        Ok(destination)
    }

    pub fn path(&self, state_root: &Path, name: &str) -> Result<PathBuf, SkillError> {
        self.directory(name)?;
        Ok(self.materialize(state_root)?.join(name))
    }

    pub fn install(&self, home: &Path) -> Result<PathBuf, SkillError> {
        let source = child_directory(
            child_directory(&INTEGRATION_DIRECTORY, "skills")?,
            "supaterm",
        )?;
        let parent = home.join(".agents/skills");
        fs::create_dir_all(&parent)?;
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o700))?;
        let destination = parent.join("supaterm");
        let temporary = parent.join(format!(".supaterm-{}", Uuid::new_v4()));
        write_directory(source, &temporary)?;
        let backup = parent.join(format!(".supaterm-backup-{}", Uuid::new_v4()));
        if fs::symlink_metadata(&destination).is_ok() {
            fs::rename(&destination, &backup)?;
        }
        if let Err(error) = fs::rename(&temporary, &destination) {
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(error.into());
        }
        if backup.exists() {
            remove_path(&backup)?;
        }
        Ok(destination)
    }

    pub fn link_install(&self, installed: &Path, destination: &Path) -> Result<(), SkillError> {
        let parent = destination.parent().ok_or(SkillError::NotFound)?;
        fs::create_dir_all(parent)?;
        if fs::symlink_metadata(destination).is_ok() {
            remove_path(destination)?;
        }
        symlink(installed, destination)?;
        Ok(())
    }

    fn directory(&self, name: &str) -> Result<&'static Dir<'static>, SkillError> {
        if !valid_name(name) {
            return Err(SkillError::NotFound);
        }
        let directory = child_directory(skill_data()?, name)?;
        directory
            .files()
            .any(|file| {
                file.path().file_name().and_then(|value| value.to_str()) == Some("SKILL.md")
            })
            .then_some(directory)
            .ok_or(SkillError::NotFound)
    }

    fn summary(&self, directory: &Dir<'_>) -> Result<Option<SkillSummary>, SkillError> {
        let Some(name) = directory.path().file_name().and_then(|name| name.to_str()) else {
            return Ok(None);
        };
        let content = utf8_file(directory, "SKILL.md")?;
        let (metadata_name, description) = frontmatter(&content)?;
        if metadata_name != name {
            return Err(SkillError::Invalid(name.into()));
        }
        Ok(Some(SkillSummary {
            name: metadata_name,
            description,
        }))
    }
}

fn skill_data() -> Result<&'static Dir<'static>, SkillError> {
    child_directory(&INTEGRATION_DIRECTORY, "skill-data")
}

fn child_directory<'a>(directory: &'a Dir<'a>, name: &str) -> Result<&'a Dir<'a>, SkillError> {
    directory
        .dirs()
        .find(|child| child.path().file_name().and_then(|value| value.to_str()) == Some(name))
        .ok_or(SkillError::NotFound)
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && name.as_bytes()[0].is_ascii_alphanumeric()
}

fn frontmatter(content: &str) -> Result<(String, String), SkillError> {
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return Err(SkillError::Invalid("missing frontmatter".into()));
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        if line == "---" {
            return name
                .zip(description)
                .ok_or_else(|| SkillError::Invalid("incomplete frontmatter".into()));
        }
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("description:") {
            description = Some(value.trim().to_owned());
        }
    }
    Err(SkillError::Invalid("unterminated frontmatter".into()))
}

fn utf8_file(directory: &Dir<'_>, name: &str) -> Result<String, SkillError> {
    let bytes = directory
        .files()
        .find(|file| file.path().file_name().and_then(|value| value.to_str()) == Some(name))
        .ok_or(SkillError::NotFound)?
        .contents();
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| SkillError::Invalid(name.into()))
}

fn collect_files(
    directory: &Dir<'_>,
    relative: &Path,
    output: &mut Vec<SkillFile>,
) -> Result<(), SkillError> {
    for entry in directory.entries() {
        match entry {
            DirEntry::Dir(child) => {
                let name = child.path().file_name().ok_or(SkillError::NotFound)?;
                collect_files(child, &relative.join(name), output)?;
            }
            DirEntry::File(file) => {
                let name = file.path().file_name().ok_or(SkillError::NotFound)?;
                let path = relative.join(name);
                output.push(SkillFile {
                    path: path.to_string_lossy().into_owned(),
                    content: std::str::from_utf8(file.contents())
                        .map_err(|_| SkillError::Invalid(path.display().to_string()))?
                        .to_owned(),
                });
            }
        }
    }
    Ok(())
}

fn write_directory(directory: &Dir<'_>, destination: &Path) -> Result<(), SkillError> {
    fs::create_dir_all(destination)?;
    fs::set_permissions(destination, fs::Permissions::from_mode(0o700))?;
    for entry in directory.entries() {
        let name = entry.path().file_name().ok_or(SkillError::NotFound)?;
        let path = destination.join(name);
        if Path::new(name).components().count() != 1 {
            return Err(SkillError::Invalid(path.display().to_string()));
        }
        match entry {
            DirEntry::Dir(child) => write_directory(child, &path)?,
            DirEntry::File(file) => {
                fs::write(&path, file.contents())?;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
            }
        }
    }
    Ok(())
}

fn remove_path(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}
