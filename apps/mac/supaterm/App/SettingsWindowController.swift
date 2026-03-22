import AppKit
import ComposableArchitecture
import SwiftUI

@MainActor
final class SettingsWindowController: NSWindowController, NSWindowDelegate {
  let store: StoreOf<SettingsFeature>

  init() {
    let store = Store(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }
    self.store = store

    let hostingController = NSHostingController(
      rootView: SettingsView(store: store)
    )

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 760, height: 560),
      styleMask: [.closable, .miniaturizable, .resizable, .titled],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = hostingController
    window.contentMinSize = NSSize(width: 720, height: 520)
    window.identifier = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.settings")
    window.isReleasedWhenClosed = false
    window.setFrameAutosaveName("SupatermSettingsWindow")
    window.title = "Settings"
    window.tabbingMode = .disallowed

    super.init(window: window)

    window.delegate = self
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func show(tab: SettingsFeature.Tab) {
    store.send(.tabSelected(tab))

    guard let window else { return }
    if window.isMiniaturized {
      window.deminiaturize(nil)
    }

    showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }
}
