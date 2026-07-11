import SupaTheme
import SwiftUI

struct GhosttySurfaceFailureOverlay: View {
  let failure: GhosttySurfaceFailure
  let palette: Palette

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 44, weight: .semibold))
        .foregroundStyle(palette.danger)
        .accessibilityHidden(true)

      VStack(spacing: 8) {
        Text(title)
          .font(.title2.weight(.semibold))
          .foregroundStyle(palette.primaryText)

        Text(message)
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
    .accessibilityIdentifier("terminal-renderer-unavailable")
  }

  private var title: String {
    switch failure {
    case .rendererUnavailable:
      "Terminal renderer unavailable"
    }
  }

  private var message: String {
    switch failure {
    case .rendererUnavailable:
      """
      The renderer stopped, usually because GPU memory is exhausted. \
      Free up system resources; this pane will resume when rendering recovers.
      """
    }
  }
}
