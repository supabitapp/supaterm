import AppKit
import ApplicationServices
import Foundation

@MainActor
final class ComputerUseFocusGuard {
  private var assertedPids: Set<pid_t> = []
  private var nonAssertablePids: Set<pid_t> = []
  private var observers: [pid_t: AXObserver] = [:]
  private let focusStealPreventer = ComputerUseSystemFocusStealPreventer()

  func withFocusSuppressed<T>(
    pid: pid_t,
    element: AXUIElement?,
    body: () throws -> T
  ) rethrows -> T {
    let app = AXUIElementCreateApplication(pid)
    let wasAsserted = assertedPids.contains(pid)
    if assertEnablement(pid: pid, app: app), !wasAsserted {
      registerObserver(pid: pid, app: app)
      pumpRunLoop()
    }
    let window = element.flatMap(enclosingWindow)
    let state = setSyntheticFocus(window: window, element: element)
    let suppression = focusStealPreventer.begin(targetPid: pid)
    do {
      let result = try body()
      restoreSyntheticFocus(state)
      if let suppression {
        focusStealPreventer.end(suppression)
      }
      return result
    } catch {
      restoreSyntheticFocus(state)
      if let suppression {
        focusStealPreventer.end(suppression)
      }
      throw error
    }
  }

  func prepareSnapshot(pid: pid_t, app: AXUIElement) {
    let wasAsserted = assertedPids.contains(pid)
    if assertEnablement(pid: pid, app: app), !wasAsserted {
      registerObserver(pid: pid, app: app)
      pumpRunLoop()
    }
  }

  private func assertEnablement(pid: pid_t, app: AXUIElement) -> Bool {
    if nonAssertablePids.contains(pid) { return false }
    let manual = AXUIElementSetAttributeValue(
      app,
      "AXManualAccessibility" as CFString,
      kCFBooleanTrue
    )
    let enhanced = AXUIElementSetAttributeValue(
      app,
      "AXEnhancedUserInterface" as CFString,
      kCFBooleanTrue
    )
    if manual == .success || enhanced == .success {
      assertedPids.insert(pid)
      return true
    }
    if !assertedPids.contains(pid) {
      nonAssertablePids.insert(pid)
    }
    return assertedPids.contains(pid)
  }

  private func registerObserver(pid: pid_t, app: AXUIElement) {
    guard observers[pid] == nil else { return }
    var observer: AXObserver?
    let error = AXObserverCreate(pid, { _, _, _, _ in }, &observer)
    guard error == .success, let observer else { return }
    for notification in notifications {
      _ = addNotification(observer: observer, element: app, notification: notification)
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
    observers[pid] = observer
  }

  private func addNotification(
    observer: AXObserver,
    element: AXUIElement,
    notification: CFString
  ) -> AXError {
    if let remote = Self.remoteNotification {
      return remote(observer, element, notification, nil)
    }
    return AXObserverAddNotification(observer, element, notification, nil)
  }

  private func pumpRunLoop() {
    let deadline = Date().addingTimeInterval(0.5)
    while Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
  }

  private func setSyntheticFocus(
    window: AXUIElement?,
    element: AXUIElement?
  ) -> ComputerUseSyntheticFocusState {
    let state = ComputerUseSyntheticFocusState(
      window: window,
      element: element,
      windowFocused: window.flatMap { bool($0, "AXFocused") },
      windowMain: window.flatMap { bool($0, "AXMain") },
      elementFocused: element.flatMap { bool($0, "AXFocused") }
    )
    if let window, bool(window, "AXMinimized") != true {
      setBool(window, "AXFocused", true)
      setBool(window, "AXMain", true)
    }
    if let element {
      setBool(element, "AXFocused", true)
    }
    return state
  }

  private func restoreSyntheticFocus(_ state: ComputerUseSyntheticFocusState) {
    if let window = state.window {
      if let value = state.windowFocused {
        setBool(window, "AXFocused", value)
      }
      if let value = state.windowMain {
        setBool(window, "AXMain", value)
      }
    }
    if let element = state.element, let value = state.elementFocused {
      setBool(element, "AXFocused", value)
    }
  }

  private func enclosingWindow(of element: AXUIElement) -> AXUIElement? {
    var value: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &value) == .success,
      let value,
      CFGetTypeID(value) == AXUIElementGetTypeID()
    else {
      return nil
    }
    return unsafeDowncast(value, to: AXUIElement.self)
  }

  private func bool(_ element: AXUIElement, _ attribute: String) -> Bool? {
    var value: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
      let value,
      CFGetTypeID(value) == CFBooleanGetTypeID()
    else {
      return nil
    }
    return CFBooleanGetValue(unsafeDowncast(value, to: CFBoolean.self))
  }

  private func setBool(_ element: AXUIElement, _ attribute: String, _ value: Bool) {
    _ = AXUIElementSetAttributeValue(
      element,
      attribute as CFString,
      (value ? kCFBooleanTrue : kCFBooleanFalse) as CFTypeRef
    )
  }

  private static let remoteNotification:
    (@convention(c) (AXObserver, AXUIElement, CFString, UnsafeMutableRawPointer?) -> AXError)? = {
      guard
        let symbol = dlsym(
          UnsafeMutableRawPointer(bitPattern: -2),
          "AXObserverAddNotificationAndCheckRemote"
        )
      else {
        return nil
      }
      return unsafeBitCast(
        symbol,
        to: (@convention(c) (AXObserver, AXUIElement, CFString, UnsafeMutableRawPointer?) -> AXError).self
      )
    }()

  private let notifications: [CFString] = [
    kAXFocusedUIElementChangedNotification as CFString,
    kAXFocusedWindowChangedNotification as CFString,
    kAXApplicationActivatedNotification as CFString,
    kAXApplicationDeactivatedNotification as CFString,
    kAXApplicationHiddenNotification as CFString,
    kAXApplicationShownNotification as CFString,
    kAXWindowCreatedNotification as CFString,
    kAXWindowMovedNotification as CFString,
    kAXWindowResizedNotification as CFString,
    kAXValueChangedNotification as CFString,
    kAXTitleChangedNotification as CFString,
    kAXSelectedChildrenChangedNotification as CFString,
    kAXLayoutChangedNotification as CFString,
  ]
}

private struct ComputerUseSyntheticFocusState {
  let window: AXUIElement?
  let element: AXUIElement?
  let windowFocused: Bool?
  let windowMain: Bool?
  let elementFocused: Bool?
}
