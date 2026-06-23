import Foundation
import SupatermSupport
import SupatermTerminalModels

extension AppDelegate {
  static func knownZmxSessionIDsForLaunchReaping(
    restoreTerminalLayoutEnabled: Bool,
    sessionCatalog: TerminalSessionCatalog,
    pinnedTabCatalog: TerminalPinnedTabCatalog,
    liveSurfaceIDs: Set<UUID>
  ) -> Set<String> {
    let persistedSurfaceIDs =
      restoreTerminalLayoutEnabled
      ? sessionCatalog.surfaceIDs
      : []
    let knownSurfaceIDs = persistedSurfaceIDs.union(pinnedTabCatalog.surfaceIDs).union(liveSurfaceIDs)
    return Set(knownSurfaceIDs.map { ZmxSessionID.make(surfaceID: $0) })
  }
}
