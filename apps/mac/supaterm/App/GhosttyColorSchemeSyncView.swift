import SupatermTerminalFeature
import SwiftUI

struct GhosttyColorSchemeSyncView<Content: View>: View {
  @Environment(\.colorScheme) private var colorScheme
  let ghostty: GhosttyRuntime
  let content: Content

  init(ghostty: GhosttyRuntime, @ViewBuilder content: () -> Content) {
    self.ghostty = ghostty
    self.content = content()
  }

  var body: some View {
    content
      .onChange(of: colorScheme, initial: true) { _, newValue in
        apply(newValue)
      }
  }

  private func apply(_ scheme: ColorScheme) {
    ghostty.setColorScheme(scheme)
  }
}
