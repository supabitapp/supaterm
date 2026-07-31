import AppKit
import SwiftUI

struct WindowTitleApplier: NSViewRepresentable {
  let title: String

  func makeNSView(context: Context) -> WindowTitleApplierView {
    let view = WindowTitleApplierView()
    view.appliedTitle = title
    return view
  }

  func updateNSView(_ nsView: WindowTitleApplierView, context: Context) {
    nsView.appliedTitle = title
  }
}

final class WindowTitleApplierView: NSView {
  var appliedTitle = "" {
    didSet {
      applyTitle()
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    applyTitle()
  }

  private func applyTitle() {
    window?.title = appliedTitle
  }
}
