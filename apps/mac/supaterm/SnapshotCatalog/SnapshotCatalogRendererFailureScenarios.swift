import SupaTheme
import SwiftUI

extension SnapshotCatalog {
  static let rendererFailureScenarios: [SnapshotScenario] = [
    scenario(
      "renderer-unavailable",
      group: "Terminal Pane",
      title: "Renderer unavailable",
      size: CGSize(width: 640, height: 400)
    ) { appearance in
      AnyView(
        GhosttySurfaceFailureOverlay(
          failure: .rendererUnavailable,
          palette: Palette(colorScheme: appearance.colorScheme)
        )
      )
    },
    scenario(
      "surface-creation-failed",
      group: "Terminal Pane",
      title: "Surface creation failed",
      size: CGSize(width: 640, height: 400)
    ) { appearance in
      AnyView(
        GhosttySurfaceFailureOverlay(
          failure: .surfaceCreationFailed,
          palette: Palette(colorScheme: appearance.colorScheme)
        )
      )
    },
  ]
}
