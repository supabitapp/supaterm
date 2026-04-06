import Combine
import Foundation
import GhosttyKit
import SwiftUI

@MainActor
final class GhosttyTerminalPreviewController: ObservableObject {
  private let notificationCenter: NotificationCenter
  private var reloadObserver: NSObjectProtocol?
  let runtime: GhosttyRuntime
  let surfaceView: GhosttySurfaceView

  init(
    configPath: String,
    notificationCenter: NotificationCenter = .default
  ) {
    self.notificationCenter = notificationCenter
    self.runtime = GhosttyRuntime(
      configPath: configPath,
      observesReloadRequests: false
    )
    self.surfaceView = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      fontSize: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    reloadObserver = notificationCenter.addObserver(
      forName: .ghosttyRuntimeReloadRequested,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard
          let self,
          let surface = self.surfaceView.surface
        else {
          return
        }
        self.runtime.reloadSurfaceConfig(surface)
      }
    }
  }

  isolated deinit {
    if let reloadObserver {
      notificationCenter.removeObserver(reloadObserver)
    }
  }
}
