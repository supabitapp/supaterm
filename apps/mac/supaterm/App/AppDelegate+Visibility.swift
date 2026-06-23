import AppKit

private final class WeakToggleVisibilityWindow {
  weak var value: NSWindow?

  init(_ value: NSWindow) {
    self.value = value
  }
}

extension AppDelegate {
  struct ToggleVisibilityState {
    private let hiddenWindows: [WeakToggleVisibilityWindow]
    private let keyWindow: WeakToggleVisibilityWindow?

    init(windows: [NSWindow] = NSApp.windows, keyWindow: NSWindow? = NSApp.keyWindow) {
      self.keyWindow = keyWindow.map(WeakToggleVisibilityWindow.init)
      var visibleWindows: [WeakToggleVisibilityWindow] = []
      for window in windows where window.isVisible && !window.styleMask.contains(.fullScreen) {
        let windowToHide = window.tabGroup?.selectedWindow ?? window
        if !visibleWindows.contains(where: { $0.value === windowToHide }) {
          visibleWindows.append(WeakToggleVisibilityWindow(windowToHide))
        }
      }
      self.hiddenWindows = visibleWindows
    }

    func restore() {
      for window in hiddenWindows {
        window.value?.orderFrontRegardless()
      }
      keyWindow?.value?.makeKey()
    }
  }
}
