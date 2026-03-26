import AppKit
import Sharing
import SwiftUI

struct AppAppearanceView<Content: View>: View {
  @Shared(.appPrefs) private var appPrefs = .default
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .preferredColorScheme(appPrefs.appearanceMode.colorScheme)
      .background {
        WindowAppearanceSetter(colorScheme: appPrefs.appearanceMode.colorScheme)
      }
  }
}

private struct WindowAppearanceSetter: NSViewRepresentable {
  let colorScheme: ColorScheme?

  func makeNSView(context: Context) -> WindowAppearanceView {
    let view = WindowAppearanceView()
    view.colorScheme = colorScheme
    return view
  }

  func updateNSView(_ nsView: WindowAppearanceView, context: Context) {
    nsView.colorScheme = colorScheme
  }
}

private final class WindowAppearanceView: NSView {
  var colorScheme: ColorScheme? {
    didSet {
      applyAppearance()
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    applyAppearance()
  }

  private func applyAppearance() {
    guard let window else { return }
    switch colorScheme {
    case .none:
      window.appearance = nil
    case .some(let colorScheme):
      switch colorScheme {
      case .light:
        window.appearance = NSAppearance(named: .aqua)
      case .dark:
        window.appearance = NSAppearance(named: .darkAqua)
      @unknown default:
        window.appearance = nil
      }
    }
  }
}
