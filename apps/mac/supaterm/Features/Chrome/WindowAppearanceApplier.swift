import AppKit
import SwiftUI

struct WindowAppearanceApplier: NSViewRepresentable {
  let colorScheme: ColorScheme

  func makeNSView(context: Context) -> WindowAppearanceApplierView {
    let view = WindowAppearanceApplierView()
    view.colorScheme = colorScheme
    return view
  }

  func updateNSView(_ nsView: WindowAppearanceApplierView, context: Context) {
    nsView.colorScheme = colorScheme
  }
}

final class WindowAppearanceApplierView: NSView {
  var colorScheme = ColorScheme.light {
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
    let name: NSAppearance.Name = colorScheme == .dark ? .darkAqua : .aqua
    guard window.appearance?.name != name else { return }
    window.appearance = NSAppearance(named: name)
    window.contentView?.needsLayout = true
    window.contentView?.needsDisplay = true
    window.contentView?.displayIfNeeded()
    window.invalidateShadow()
  }
}
