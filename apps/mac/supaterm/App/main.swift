import AppKit
import Darwin

#if !SUPATERM_SNAPSHOT_CATALOG
  import SupatermCLIShared
#endif

let app = NSApplication.shared

#if SUPATERM_SNAPSHOT_CATALOG
  let delegate = SnapshotCatalogAppDelegate()
#else
  do {
    try GhosttyBootstrap.initialize()
  } catch {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Supaterm could not start"
    alert.informativeText = error.localizedDescription
    alert.runModal()
    Darwin.exit(EXIT_FAILURE)
  }
  SupatermSettingsMigration.migrateDefaultSettingsIfNeeded()
  let delegate = AppDelegate()
#endif

app.delegate = delegate
app.run()
