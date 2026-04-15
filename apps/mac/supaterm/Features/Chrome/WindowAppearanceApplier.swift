import AppKit
import SwiftUI

struct WindowAppearanceApplier: NSViewRepresentable {
  let appliedAppearance: NSAppearance

  func makeNSView(context: Context) -> WindowAppearanceApplierView {
    let view = WindowAppearanceApplierView()
    view.appliedAppearance = appliedAppearance
    return view
  }

  func updateNSView(_ nsView: WindowAppearanceApplierView, context: Context) {
    nsView.appliedAppearance = appliedAppearance
  }
}

final class WindowAppearanceApplierView: NSView {
  var appliedAppearance: NSAppearance = NSAppearance(named: .darkAqua) ?? NSAppearance(
    named: .aqua
  )! {
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
    window.appearance = appliedAppearance
    window.contentView?.needsLayout = true
    window.contentView?.needsDisplay = true
    window.contentView?.displayIfNeeded()
    window.invalidateShadow()
  }
}
