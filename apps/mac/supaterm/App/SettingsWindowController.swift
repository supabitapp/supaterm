import AppKit
import ComposableArchitecture
import SwiftUI

@MainActor
final class SettingsWindowController: NSWindowController, NSWindowDelegate {
  let store: StoreOf<SettingsFeature>
  private let restoresSavedFrame: Bool
  private let tabViewController: SettingsTabViewController

  init() {
    let store = Store(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }
    self.store = store
    let tabViewController = SettingsTabViewController(store: store)
    self.tabViewController = tabViewController

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 760, height: 560),
      styleMask: [.closable, .miniaturizable, .resizable, .titled],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = tabViewController
    window.contentMinSize = NSSize(width: 520, height: 360)
    window.identifier = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.settings")
    window.isReleasedWhenClosed = false
    let restoresSavedFrame = window.setFrameUsingName("SupatermSettingsWindow")
    self.restoresSavedFrame = restoresSavedFrame
    window.setFrameAutosaveName("SupatermSettingsWindow")
    window.title = "Settings"
    window.tabbingMode = .disallowed
    window.toolbarStyle = .preference

    super.init(window: window)

    window.delegate = self
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func show(tab: SettingsFeature.Tab, relativeTo sourceWindow: NSWindow? = nil) {
    tabViewController.select(tab)

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

private extension NSRect {
  func constrained(to bounds: NSRect) -> NSRect {
    let x = min(max(origin.x, bounds.minX), bounds.maxX - width)
    let y = min(max(origin.y, bounds.minY), bounds.maxY - height)
    return NSRect(x: x, y: y, width: width, height: height)
  }
}

@MainActor
private final class SettingsTabViewController: NSTabViewController {
  private let store: StoreOf<SettingsFeature>

  init(store: StoreOf<SettingsFeature>) {
    self.store = store
    super.init(nibName: nil, bundle: nil)
    canPropagateSelectedChildViewControllerTitle = true
    tabStyle = .toolbar
    transitionOptions = []
    SettingsFeature.Tab.allCases.forEach { addTabViewItem(makeTabViewItem(for: $0)) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    syncSelection()
  }

  override func tabView(_ tabView: NSTabView, didSelect tabViewItem: NSTabViewItem?) {
    super.tabView(tabView, didSelect: tabViewItem)
    guard let tab = tab(for: tabViewItem) else { return }
    _ = store.send(.tabSelected(tab))
  }

  override func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [.flexibleSpace] + super.toolbarDefaultItemIdentifiers(toolbar) + [.flexibleSpace]
  }

  override func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    super.toolbarAllowedItemIdentifiers(toolbar) + [.flexibleSpace]
  }

  func select(_ tab: SettingsFeature.Tab) {
    _ = store.send(.tabSelected(tab))
    loadViewIfNeeded()
    syncSelection()
  }

  private func syncSelection() {
    guard let index = SettingsFeature.Tab.allCases.firstIndex(of: store.selectedTab) else { return }
    selectedTabViewItemIndex = index
  }

  private func tab(for tabViewItem: NSTabViewItem?) -> SettingsFeature.Tab? {
    guard let identifier = tabViewItem?.identifier as? String else { return nil }
    return SettingsFeature.Tab(rawValue: identifier)
  }

  private func makeTabViewItem(for tab: SettingsFeature.Tab) -> NSTabViewItem {
    let viewController = NSHostingController(rootView: SettingsTabContentView(tab: tab))
    viewController.title = tab.title

    let tabViewItem = NSTabViewItem(identifier: tab.rawValue)
    tabViewItem.viewController = viewController
    tabViewItem.label = tab.title
    tabViewItem.image = NSImage(systemSymbolName: tab.symbol, accessibilityDescription: tab.title)
    tabViewItem.toolTip = tab.detail
    return tabViewItem
  }
}
