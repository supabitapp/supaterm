import AppKit
import SwiftUI

struct WindowAppearanceApplier: NSViewRepresentable {
  let appliedAppearance: NSAppearance?

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
  var appliedAppearance: NSAppearance? {
    didSet {
      applyAppearance(reason: "appearanceChanged")
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    applyAppearance(reason: "viewDidMoveToWindow")
  }

  private func applyAppearance(reason: String) {
    guard let window else { return }
    AppearanceDiagnostics.log(
      [
        "terminal appearance",
        "reason=\(reason)",
        "requested=\(AppearanceDiagnostics.describe(appliedAppearance))",
        "before=\(AppearanceDiagnostics.describe(window: window))",
      ].joined(separator: " ")
    )
    window.appearance = appliedAppearance
    window.contentView?.needsLayout = true
    window.contentView?.needsDisplay = true
    window.contentView?.displayIfNeeded()
    window.invalidateShadow()
    AppearanceDiagnostics.log(
      [
        "terminal appearance applied",
        "reason=\(reason)",
        "requested=\(AppearanceDiagnostics.describe(appliedAppearance))",
        "after=\(AppearanceDiagnostics.describe(window: window))",
      ].joined(separator: " ")
    )
  }
}
