import SupaTheme
import SwiftUI

extension SnapshotCatalog {
  static let rendererFailureScenarios: [SnapshotScenario] = [
    rendererFailureScenario(
      "renderer-unavailable",
      title: "Renderer unavailable",
      failure: .rendererUnavailable
    ),
    rendererFailureScenario(
      "surface-creation-failed",
      title: "Surface creation failed",
      failure: .surfaceCreationFailed
    ),
  ]

  private static func rendererFailureScenario(
    _ id: String,
    title: String,
    failure: GhosttySurfaceFailure
  ) -> SnapshotScenario {
    scenario(
      id,
      group: "Terminal Pane",
      title: title,
      size: CGSize(width: 640, height: 400)
    ) { appearance in
      AnyView(
        GhosttySurfaceFailureOverlay(
          failure: failure,
          palette: Palette(colorScheme: appearance.colorScheme)
        )
      )
    }
  }
}
