import AppKit
import ComposableArchitecture
import SwiftUI

@MainActor
final class SettingsWindowController: NSWindowController {
  let store: StoreOf<SettingsFeature>
  private let restoresSavedFrame: Bool

  init() {
    let store = Store(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }
    self.store = store
    let rootView = AppAppearanceView {
      SettingsView(store: store)
    }
    let hostingController = NSHostingController(rootView: rootView)
    let window = NSWindow(contentViewController: hostingController)
    window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
    window.setContentSize(NSSize(width: 800, height: 600))
    window.contentMinSize = NSSize(width: 750, height: 500)
    window.minSize = NSSize(width: 750, height: 500)
    window.identifier = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.settings")
    window.isReleasedWhenClosed = false
    let restoresSavedFrame = window.setFrameUsingName("SupatermSettingsWindow")
    self.restoresSavedFrame = restoresSavedFrame
    window.setFrameAutosaveName("SupatermSettingsWindow")
    window.title = ""
    window.titleVisibility = .hidden
    window.tabbingMode = .disallowed
    window.titlebarAppearsTransparent = true
    window.toolbarStyle = .unified
    window.toolbar = NSToolbar(identifier: "SettingsToolbar")

    super.init(window: window)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func show(tab: SettingsFeature.Tab, relativeTo sourceWindow: NSWindow? = nil) {
    _ = store.send(.tabSelected(tab))

    guard let window else { return }
    if window.isMiniaturized {
      window.deminiaturize(nil)
    }
    if !restoresSavedFrame && !window.isVisible {
      position(window: window, relativeTo: sourceWindow)
    }

    showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }

  private func position(window: NSWindow, relativeTo sourceWindow: NSWindow?) {
    guard let sourceWindow else {
      window.center()
      return
    }

    let visibleFrame = sourceWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? sourceWindow.frame
    let frame = window.frame
    let origin = NSPoint(
      x: sourceWindow.frame.midX - frame.width / 2,
      y: sourceWindow.frame.midY - frame.height / 2
    )
    let positionedFrame = NSRect(origin: origin, size: frame.size)
    window.setFrame(positionedFrame.constrained(to: visibleFrame), display: false)
  }
}

extension NSRect {
  fileprivate func constrained(to bounds: NSRect) -> NSRect {
    let x = min(max(origin.x, bounds.minX), bounds.maxX - width)
    let y = min(max(origin.y, bounds.minY), bounds.maxY - height)
    return NSRect(x: x, y: y, width: width, height: height)
  }
}
