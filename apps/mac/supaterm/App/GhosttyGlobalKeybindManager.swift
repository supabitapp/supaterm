import AppKit
import ApplicationServices
import CoreGraphics

protocol GhosttyGlobalEventTapRegistration: AnyObject {
  nonisolated func invalidate()
}

@MainActor
final class GhosttyGlobalKeybindManager {
  static let shared = GhosttyGlobalKeybindManager()

  private let isAccessibilityTrusted: () -> Bool
  private let requestAccessibilityTrust: () -> Void
  private let makeEventTapRegistration: () -> GhosttyGlobalEventTapRegistration?
  private let isAppActive: () -> Bool
  private var runtime: GhosttyRuntime?
  private var eventTapRegistration: GhosttyGlobalEventTapRegistration?
  private var enableTimer: Timer?
  private var configObserver: NSObjectProtocol?
  private var hasRequestedAccessibilityTrust = false

  var isEnabled: Bool {
    eventTapRegistration != nil
  }

  init(
    isAccessibilityTrusted: @escaping () -> Bool = { AXIsProcessTrusted() },
    requestAccessibilityTrust: @escaping () -> Void = {
      _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    },
    makeEventTapRegistration: @escaping () -> GhosttyGlobalEventTapRegistration? = {
      LiveGhosttyGlobalEventTapRegistration.create()
    },
    isAppActive: @escaping () -> Bool = { NSApp.isActive },
    runtime: GhosttyRuntime? = nil
  ) {
    self.isAccessibilityTrusted = isAccessibilityTrusted
    self.requestAccessibilityTrust = requestAccessibilityTrust
    self.makeEventTapRegistration = makeEventTapRegistration
    self.isAppActive = isAppActive
    self.runtime = runtime
    if let runtime {
      installConfigObserver(for: runtime)
    }
  }

  isolated deinit {
    enableTimer?.invalidate()
    eventTapRegistration?.invalidate()
    if let configObserver {
      NotificationCenter.default.removeObserver(configObserver)
    }
  }

  func setRuntime(_ runtime: GhosttyRuntime) {
    self.runtime = runtime
    installConfigObserver(for: runtime)
    refresh()
  }

  func refresh() {
    if runtime?.hasGlobalKeybinds() == true {
      enable()
    } else {
      disable()
    }
  }

  func disable() {
    enableTimer?.invalidate()
    enableTimer = nil
    eventTapRegistration?.invalidate()
    eventTapRegistration = nil
  }

  func handle(_ event: GhosttyGlobalKeyEvent) -> Bool {
    guard !isAppActive() else { return false }
    return runtime?.handleGlobalKeyEvent(event) ?? false
  }

  private func enable() {
    guard eventTapRegistration == nil else { return }
    enableTimer?.invalidate()
    enableTimer = nil
    guard !tryEnable() else { return }
    enableTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
      Task { @MainActor [weak self] in
        _ = self?.tryEnable()
      }
    }
  }

  private func tryEnable() -> Bool {
    guard isAccessibilityTrusted() else {
      requestAccessibilityTrustIfNeeded()
      return false
    }
    guard let registration = makeEventTapRegistration() else { return false }
    eventTapRegistration = registration
    enableTimer?.invalidate()
    enableTimer = nil
    return true
  }

  private func requestAccessibilityTrustIfNeeded() {
    guard !hasRequestedAccessibilityTrust else { return }
    hasRequestedAccessibilityTrust = true
    requestAccessibilityTrust()
  }

  private func installConfigObserver(for runtime: GhosttyRuntime) {
    if let configObserver {
      NotificationCenter.default.removeObserver(configObserver)
    }
    configObserver = NotificationCenter.default.addObserver(
      forName: .ghosttyRuntimeConfigDidChange,
      object: runtime,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.refresh()
      }
    }
  }
}

private final class LiveGhosttyGlobalEventTapRegistration: GhosttyGlobalEventTapRegistration {
  nonisolated(unsafe) private let eventTap: CFMachPort
  nonisolated(unsafe) private let source: CFRunLoopSource

  private init(eventTap: CFMachPort, source: CFRunLoopSource) {
    self.eventTap = eventTap
    self.source = source
  }

  static func create() -> GhosttyGlobalEventTapRegistration? {
    let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)
    guard
      let eventTap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: eventMask,
        callback: supatermGlobalKeybindEventTapCallback,
        userInfo: nil
      )
    else { return nil }
    guard let source = CFMachPortCreateRunLoopSource(nil, eventTap, 0) else {
      CFMachPortInvalidate(eventTap)
      return nil
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    return LiveGhosttyGlobalEventTapRegistration(eventTap: eventTap, source: source)
  }

  nonisolated func invalidate() {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
    CFMachPortInvalidate(eventTap)
  }
}

private nonisolated func supatermGlobalKeybindEventTapCallback(
  _: CGEventTapProxy,
  type: CGEventType,
  cgEvent: CGEvent,
  _: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
  let result = Unmanaged.passUnretained(cgEvent)
  guard type == .keyDown else { return result }
  guard let event = GhosttyGlobalKeyEvent(cgEvent: cgEvent) else { return result }
  let handled: Bool
  if Thread.isMainThread {
    handled = MainActor.assumeIsolated {
      GhosttyGlobalKeybindManager.shared.handle(event)
    }
  } else {
    handled = DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        GhosttyGlobalKeybindManager.shared.handle(event)
      }
    }
  }
  return handled ? nil : result
}
