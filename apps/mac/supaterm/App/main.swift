import AppKit
import Darwin

#if !SUPATERM_SNAPSHOT_CATALOG
  import SupatermSupport
#endif

let app = NSApplication.shared

#if SUPATERM_SNAPSHOT_CATALOG
  let delegate = SnapshotCatalogAppDelegate()
#else
  func refuseLaunch(_ messageText: String, _ informativeText: String) -> Never {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = messageText
    alert.informativeText = informativeText
    alert.runModal()
    Darwin.exit(EXIT_FAILURE)
  }

  do {
    try GhosttyBootstrap.initialize()
  } catch {
    refuseLaunch("Supaterm could not start", error.localizedDescription)
  }
  let delegate = AppDelegate()
#endif

app.delegate = delegate
app.run()
