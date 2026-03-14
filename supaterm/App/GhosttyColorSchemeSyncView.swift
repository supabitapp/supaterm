import SwiftUI

struct GhosttyColorSchemeSyncView<Content: View>: View {
  @Environment(\.colorScheme) private var colorScheme
  let applyColorScheme: (ColorScheme) -> Void
  let content: Content

  init(
    applyColorScheme: @escaping (ColorScheme) -> Void,
    @ViewBuilder content: () -> Content
  ) {
    self.applyColorScheme = applyColorScheme
    self.content = content()
  }

  var body: some View {
    content
      .task {
        apply(colorScheme)
      }
      .onChange(of: colorScheme) { _, newValue in
        apply(newValue)
      }
  }

  private func apply(_ scheme: ColorScheme) {
    applyColorScheme(scheme)
  }
}
