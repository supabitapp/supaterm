import AppKit
import Sharing
import SupatermSettingsFeature
import SupatermSupport
import SwiftUI

struct AppAppearanceView<Content: View>: View {
  @Shared(.supatermSettings) private var supatermSettings = .default
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .preferredColorScheme(supatermSettings.appearanceMode.colorScheme)
      .background {
        ApplicationAppearanceSetter(appearanceMode: supatermSettings.appearanceMode)
      }
  }
}

private struct ApplicationAppearanceSetter: NSViewRepresentable {
  let appearanceMode: AppearanceMode

  func makeNSView(context: Context) -> ApplicationAppearanceView {
    let view = ApplicationAppearanceView()
    view.appearanceMode = appearanceMode
    return view
  }

  func updateNSView(_ nsView: ApplicationAppearanceView, context: Context) {
    nsView.appearanceMode = appearanceMode
  }
}

private final class ApplicationAppearanceView: NSView {
  var appearanceMode: AppearanceMode = .system {
    didSet {
      applyAppearance()
    }
  }

  private func applyAppearance() {
    let appearance = appearanceMode.appearance
    guard NSApp.appearance?.name != appearance?.name else { return }
    NSApp.appearance = appearance
  }
}
