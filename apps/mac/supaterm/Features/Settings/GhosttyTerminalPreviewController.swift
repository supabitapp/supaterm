import Combine
import Foundation
import GhosttyKit
import SwiftUI

@MainActor
final class GhosttyTerminalPreviewController: ObservableObject {
  let configPath: String
  let runtime: GhosttyRuntime
  let surfaceView: GhosttySurfaceView

  init(configPath: String) {
    self.configPath = configPath
    self.runtime = GhosttyRuntime(configPath: configPath)
    self.surfaceView = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      fontSize: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
  }
}
