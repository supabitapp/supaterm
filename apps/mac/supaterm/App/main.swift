import AppKit

#if !SUPATERM_SNAPSHOT_CATALOG
  import SupatermCLIShared
#endif

let app = NSApplication.shared

#if SUPATERM_SNAPSHOT_CATALOG
  let delegate = SnapshotCatalogAppDelegate()
#else
  SupatermSettingsMigration.migrateDefaultSettingsIfNeeded()
  let delegate = AppDelegate()
#endif

app.delegate = delegate
app.run()
