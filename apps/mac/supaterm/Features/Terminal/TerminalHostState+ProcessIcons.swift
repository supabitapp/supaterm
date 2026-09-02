import Foundation
import SupatermSupport

extension TerminalHostState {
  func setProcessIcon(_ icon: TerminalProcessIcon?, for surfaceID: UUID) {
    guard surfaces[surfaceID] != nil else { return }
    if let icon {
      guard paneProcessIconsBySurfaceID[surfaceID] != icon else { return }
      paneProcessIconsBySurfaceID[surfaceID] = icon
    } else {
      paneProcessIconsBySurfaceID.removeValue(forKey: surfaceID)
    }
  }
}
