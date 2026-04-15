import AppKit
import SupatermCLIShared

SupatermSettingsMigration.migrateDefaultSettingsIfNeeded()
let app = NSApplication.shared
let delegate = AppDelegate()

app.delegate = delegate
app.run()
