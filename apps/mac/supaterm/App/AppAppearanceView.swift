import AppKit
import Sharing
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
        WindowAppearanceSetter(appearanceMode: supatermSettings.appearanceMode)
      }
  }
}

private struct WindowAppearanceSetter: NSViewRepresentable {
  let appearanceMode: AppearanceMode

  func makeNSView(context: Context) -> WindowAppearanceView {
    let view = WindowAppearanceView()
    view.appearanceMode = appearanceMode
    return view
  }

  func updateNSView(_ nsView: WindowAppearanceView, context: Context) {
    nsView.appearanceMode = appearanceMode
  }
}

private final class WindowAppearanceView: NSView {
  var appearanceMode: AppearanceMode = .system {
    didSet {
      applyAppearance()
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    applyAppearance()
  }

  private func applyAppearance() {
    guard window != nil else { return }
    let appearance = appearanceMode.appearance
    NSApp.appearance = appearance
    for window in NSApp.windows {
      window.appearance = appearance
      window.contentView?.needsLayout = true
      window.contentView?.needsDisplay = true
      window.contentView?.displayIfNeeded()
      window.invalidateShadow()
    }
  }
}
