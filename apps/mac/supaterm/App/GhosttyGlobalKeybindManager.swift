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
  private var runtimes: () -> [GhosttyRuntime]
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
    runtimes: @escaping () -> [GhosttyRuntime] = { [] }
  ) {
    self.isAccessibilityTrusted = isAccessibilityTrusted
    self.requestAccessibilityTrust = requestAccessibilityTrust
    self.makeEventTapRegistration = makeEventTapRegistration
    self.isAppActive = isAppActive
    self.runtimes = runtimes
  }

  func setRuntimeProvider(_ provider: @escaping () -> [GhosttyRuntime]) {
    runtimes = provider
    installConfigObserver()
    refresh()
  }

  func refresh() {
    if runtimes().contains(where: { $0.hasGlobalKeybinds() }) {
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
    for runtime in runtimes() where runtime.handleGlobalKeyEvent(event) {
      return true
    }
    return false
  }

  private func enable() {
    guard eventTapRegistration == nil else { return }
    enableTimer?.invalidate()
    enableTimer = nil
    if tryEnable() {
      return
    }
    enableTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
      Task { @MainActor [weak self] in
        _ = self?.tryEnable()
      }
    }
  }

  private func tryEnable() -> Bool {
    if !isAccessibilityTrusted() {
      if !hasRequestedAccessibilityTrust {
        hasRequestedAccessibilityTrust = true
        requestAccessibilityTrust()
      }
      return false
    }
    guard let registration = makeEventTapRegistration() else { return false }
    eventTapRegistration = registration
    enableTimer?.invalidate()
    enableTimer = nil
    return true
  }

  private func installConfigObserver() {
    guard configObserver == nil else { return }
    configObserver = NotificationCenter.default.addObserver(
      forName: .ghosttyRuntimeConfigDidChange,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { @MainActor [weak self] in
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
