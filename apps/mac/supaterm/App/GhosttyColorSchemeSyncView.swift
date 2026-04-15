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
      .task {
        apply(colorScheme, reason: "task")
      }
      .onChange(of: colorScheme) { _, newValue in
        apply(newValue, reason: "colorSchemeChanged")
      }
  }

  private func apply(_ scheme: ColorScheme, reason: String) {
    AppearanceDiagnostics.log(
      [
        "ghostty sync",
        "reason=\(reason)",
        "inheritedColorScheme=\(AppearanceDiagnostics.describe(scheme))",
        "runtimeChromeColorScheme=\(AppearanceDiagnostics.describe(ghostty.chromeColorScheme()))",
      ].joined(separator: " ")
    )
    ghostty.setColorScheme(scheme)
  }
}
