import SupaTheme
import SwiftUI

struct GhosttySurfaceFailureOverlay: View {
  private struct Presentation {
    let accessibilityIdentifier: String
    let title: String
    let message: String
  }

  let failure: GhosttySurfaceFailure
  let palette: Palette

  var body: some View {
    let presentation = Self.presentation(for: failure)
    VStack(spacing: 16) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 44, weight: .semibold))
        .foregroundStyle(palette.danger)
        .accessibilityHidden(true)

      VStack(spacing: 8) {
        Text(presentation.title)
          .font(.title2.weight(.semibold))
          .foregroundStyle(palette.primaryText)

        Text(presentation.message)
          .font(.body)
          .foregroundStyle(palette.secondaryText)
          .multilineTextAlignment(.center)
          .frame(maxWidth: 430)
      }
    }
    .padding(32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(palette.detailBackground)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier(presentation.accessibilityIdentifier)
  }

  private static func presentation(
    for failure: GhosttySurfaceFailure
  ) -> Presentation {
    switch failure {
    case .rendererUnavailable:
      Presentation(
        accessibilityIdentifier: "terminal-renderer-unavailable",
        title: "Terminal renderer unavailable",
        message: """
          The renderer stopped, usually because GPU memory is exhausted. \
          Free up system resources; this pane will resume when rendering recovers.
          """
      )
    case .surfaceCreationFailed:
      Presentation(
        accessibilityIdentifier: "terminal-surface-creation-failed",
        title: "Terminal failed to start",
        message: "The terminal surface could not be created. Open a new pane to try again."
      )
    }
  }
}
