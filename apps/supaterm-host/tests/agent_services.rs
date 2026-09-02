use serde_json::{Value, json};
use std::fs;
use supaterm_host::agent::integration::{IntegrationHealth, IntegrationManager};
use supaterm_host::agent::manifest::{DetectionCatalog, DetectionManifest};
use supaterm_host::agent::skills::SkillCatalog;
use tempfile::tempdir;

#[test]
fn embedded_detection_catalog_loads_title_screen_and_fork_rules() {
    let catalog = DetectionCatalog::embedded().unwrap();

    assert!(catalog.manifests().len() >= 3);
    assert!(
        catalog
            .manifests()
            .iter()
            .any(|manifest| { catalog.detect_title(&manifest.id, "◐ active").is_some() })
    );
    assert!(
        catalog
            .manifests()
            .iter()
            .any(|manifest| { catalog.detect_screen(&manifest.id, "Working...").is_some() })
    );
    assert!(
        catalog
            .manifests()
            .iter()
            .any(|manifest| { catalog.fork_command(&manifest.id, "session_1").is_some() })
    );
}

#[test]
fn manifest_parser_rejects_unknown_fields_and_deep_predicates() {
    let unknown =
        b"id='agent'\nversion='1'\n[[rules]]\nid='x'\nstate='idle'\nunknown=true\ncontains=['x']";
    let deep = b"id='agent'\nversion='1'\n[[rules]]\nid='x'\nstate='idle'\nall=[{all=[{all=[{all=[{all=[{all=[{all=[{all=[{contains=['x']}]}]}]}]}]}]}]}]";

    assert!(DetectionManifest::parse(unknown).is_err());
    assert!(DetectionManifest::parse(deep).is_err());
}

#[test]
fn embedded_skills_list_get_materialize_and_install() {
    let root = tempdir().unwrap();
    let home = root.path().join("home");
    let state = root.path().join("state");
    fs::create_dir(&home).unwrap();
    fs::create_dir(&state).unwrap();
    let catalog = SkillCatalog;

    let summaries = catalog.list().unwrap();
    assert!(summaries.iter().any(|skill| skill.name == "core"));
    let content = catalog.get("core", true).unwrap();
    assert_eq!(content.name, "core");
    assert!(
        content
            .files
            .as_ref()
            .is_some_and(|files| !files.is_empty())
    );
    let path = catalog.path(&state, "core").unwrap();
    assert!(path.join("SKILL.md").is_file());
    let installed = catalog.install(&home).unwrap();
    assert!(installed.join("SKILL.md").is_file());
    assert!(catalog.get("../core", false).is_err());
}

#[test]
fn integration_setup_is_idempotent_preserves_user_state_and_removes_only_managed_data() {
    let root = tempdir().unwrap();
    let home = root.path().join("home");
    fs::create_dir(&home).unwrap();
    let catalog = DetectionCatalog::embedded().unwrap();
    let manifest = catalog
        .manifests()
        .iter()
        .find(|manifest| manifest.integration.is_some())
        .unwrap();
    let descriptor = manifest.integration.as_ref().unwrap();
    let directory = home.join(format!(".{}", manifest.id));
    fs::create_dir(&directory).unwrap();
    let path = directory.join(&descriptor.settings_file);
    fs::write(
        &path,
        serde_json::to_vec(&json!({"user_setting": true})).unwrap(),
    )
    .unwrap();
    let manager = IntegrationManager::new(home, catalog.clone());

    assert_eq!(
        manager.setup(&manifest.id, true).unwrap(),
        IntegrationHealth::Healthy
    );
    assert_eq!(
        manager.repair(&manifest.id, true).unwrap(),
        IntegrationHealth::Healthy
    );
    let installed: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(installed["user_setting"], true);
    assert_eq!(
        manager.remove(&manifest.id, true).unwrap(),
        IntegrationHealth::Absent
    );
    let removed: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(removed, json!({"user_setting": true}));
}
