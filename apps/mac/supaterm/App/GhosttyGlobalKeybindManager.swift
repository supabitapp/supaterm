import AppKit
import ApplicationServices
import CoreGraphics

protocol GhosttyGlobalEventTapRegistration: AnyObject {
  func invalidate()
}

@MainActor
final class GhosttyGlobalKeybindManager {
  private let runtime: GhosttyRuntime
  private let isAccessibilityTrusted: () -> Bool
  private let requestAccessibilityTrust: () -> Void
  private let makeEventTapRegistration: (GhosttyGlobalKeybindManager) -> GhosttyGlobalEventTapRegistration?
  private let isAppActive: () -> Bool
  private var eventTapRegistration: GhosttyGlobalEventTapRegistration?
  private var enableTimer: Timer?
  private var configObserver: NSObjectProtocol?
  private var hasRequestedAccessibilityTrust = false

  var isEnabled: Bool {
    eventTapRegistration != nil
  }

  init(
    runtime: GhosttyRuntime,
    isAccessibilityTrusted: @escaping () -> Bool = { AXIsProcessTrusted() },
    requestAccessibilityTrust: @escaping () -> Void = {
      _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    },
    makeEventTapRegistration:
      @escaping (GhosttyGlobalKeybindManager) ->
      GhosttyGlobalEventTapRegistration? = { manager in
        LiveGhosttyGlobalEventTapRegistration.create(manager: manager)
      },
    isAppActive: @escaping () -> Bool = { NSApp.isActive }
  ) {
    self.runtime = runtime
    self.isAccessibilityTrusted = isAccessibilityTrusted
    self.requestAccessibilityTrust = requestAccessibilityTrust
    self.makeEventTapRegistration = makeEventTapRegistration
    self.isAppActive = isAppActive
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

  isolated deinit {
    enableTimer?.invalidate()
    eventTapRegistration?.invalidate()
    if let configObserver {
      NotificationCenter.default.removeObserver(configObserver)
    }
  }

  func refresh() {
    if runtime.hasGlobalKeybinds() {
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
    return runtime.handleGlobalKeyEvent(event)
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
    guard let registration = makeEventTapRegistration(self) else { return false }
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
}

private final class GhosttyGlobalEventTapCallbackState {
  weak var manager: GhosttyGlobalKeybindManager?

  init(manager: GhosttyGlobalKeybindManager) {
    self.manager = manager
  }
}

private final class LiveGhosttyGlobalEventTapRegistration: GhosttyGlobalEventTapRegistration {
  private let eventTap: CFMachPort
  private let source: CFRunLoopSource
  private let callbackState: GhosttyGlobalEventTapCallbackState

  private init(
    eventTap: CFMachPort,
    source: CFRunLoopSource,
    callbackState: GhosttyGlobalEventTapCallbackState
  ) {
    self.eventTap = eventTap
    self.source = source
    self.callbackState = callbackState
  }

  static func create(manager: GhosttyGlobalKeybindManager)
    -> GhosttyGlobalEventTapRegistration?
  {
    let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)
    let callbackState = GhosttyGlobalEventTapCallbackState(manager: manager)
    guard
      let eventTap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: eventMask,
        callback: supatermGlobalKeybindEventTapCallback,
        userInfo: Unmanaged.passUnretained(callbackState).toOpaque()
      )
    else {
      return nil
    }
    guard let source = CFMachPortCreateRunLoopSource(nil, eventTap, 0) else {
      CFMachPortInvalidate(eventTap)
      return nil
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    return LiveGhosttyGlobalEventTapRegistration(
      eventTap: eventTap,
      source: source,
      callbackState: callbackState
    )
  }

  func invalidate() {
    callbackState.manager = nil
    CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
    CFMachPortInvalidate(eventTap)
  }
}

private nonisolated func supatermGlobalKeybindEventTapCallback(
  _: CGEventTapProxy,
  type: CGEventType,
  cgEvent: CGEvent,
  userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
  let result = Unmanaged.passUnretained(cgEvent)
  guard type == .keyDown else { return result }
  guard let event = GhosttyGlobalKeyEvent(cgEvent: cgEvent) else { return result }
  guard let userInfo else { return result }
  let callbackStateBits = UInt(bitPattern: userInfo)
  let handled: Bool
  if Thread.isMainThread {
    handled = MainActor.assumeIsolated {
      handleGhosttyGlobalEvent(callbackStateBits: callbackStateBits, event: event)
    }
  } else {
    handled = DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        handleGhosttyGlobalEvent(callbackStateBits: callbackStateBits, event: event)
      }
    }
  }
  return handled ? nil : result
}

private func handleGhosttyGlobalEvent(
  callbackStateBits: UInt,
  event: GhosttyGlobalKeyEvent
) -> Bool {
  guard let pointer = UnsafeMutableRawPointer(bitPattern: callbackStateBits) else { return false }
  let callbackState = Unmanaged<GhosttyGlobalEventTapCallbackState>
    .fromOpaque(pointer)
    .takeUnretainedValue()
  return callbackState.manager?.handle(event) ?? false
}
