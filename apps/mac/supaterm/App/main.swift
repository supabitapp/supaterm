import AppKit
import Darwin
import SupatermUI
import SwiftUI

#if !SUPATERM_SNAPSHOT_CATALOG
  import SupatermCLIShared
  import SupatermSupport
#endif

let app = NSApplication.shared

#if SUPATERM_SNAPSHOT_CATALOG
  let delegate = SnapshotCatalogAppDelegate()
#else
  func refuseLaunch(_ messageText: String, _ informativeText: String) -> Never {
    let presenter = DialogSurfacePresenter()
    _ = presenter.runModal(
      over: nil,
      standaloneSize: CGSize(width: 680, height: 480)
    ) {
      LaunchFailureDialog(
        title: messageText,
        message: informativeText,
        onQuit: {
          presenter.finish(with: .OK)
        }
      )
    }
    Darwin.exit(EXIT_FAILURE)
  }

  let instanceName = SupatermInstanceIdentity.resolvedName()
  let instanceClaim = SupatermInstanceLock.claim(instanceName: instanceName)
  if case .taken = instanceClaim {
    refuseLaunch(
      "Supaterm is already running",
      """
      Another Supaterm process owns the instance name “\(instanceName)”, and processes that \
      share a name also share their terminal sessions and their saved layout.

      Set SUPATERM_INSTANCE_NAME to run a second instance.
      """
    )
  }

  do {
    try GhosttyBootstrap.initialize()
  } catch {
    refuseLaunch("Supaterm could not start", error.localizedDescription)
  }
  try? SupatermSettingsMigration().migrateIfNeeded()
  #if SUPATERM_DEMO
    DemoSeed.seedCatalogs()
  #endif
  let delegate = AppDelegate()
#endif

app.delegate = delegate
app.run()
