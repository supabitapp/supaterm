import AppKit
import Carbon
import Testing

@testable import supaterm

@MainActor
struct GhosttyGlobalKeybindManagerTests {
  @Test
  func refreshEnablesEventTapWhenRuntimeHasGlobalKeybinds() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    let registration = FakeGhosttyGlobalEventTapRegistration()
    var registrationCount = 0
    var requestCount = 0
    let manager = GhosttyGlobalKeybindManager(
      isAccessibilityTrusted: { true },
      requestAccessibilityTrust: { requestCount += 1 },
      makeEventTapRegistration: {
        registrationCount += 1
        return registration
      },
      runtimes: { [runtime] }
    )

    manager.refresh()

    #expect(manager.isEnabled)
    #expect(registrationCount == 1)
    #expect(requestCount == 0)
    #expect(!registration.invalidated)

    manager.disable()

    #expect(registration.invalidated)
  }

  @Test
  func refreshDisablesEventTapWhenGlobalKeybindsDisappear() throws {
    let globalRuntime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    let localRuntime = try makeGhosttyRuntime(
      """
      keybind = super+shift+0=toggle_visibility
      """
    )
    var activeRuntimes = [globalRuntime]
    let registration = FakeGhosttyGlobalEventTapRegistration()
    let manager = GhosttyGlobalKeybindManager(
      isAccessibilityTrusted: { true },
      makeEventTapRegistration: { registration },
      runtimes: { activeRuntimes }
    )

    manager.refresh()
    activeRuntimes = [localRuntime]
    manager.refresh()

    #expect(!manager.isEnabled)
    #expect(registration.invalidated)
  }

  @Test
  func refreshRequestsAccessibilityBeforeCreatingEventTap() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    var requestCount = 0
    var registrationCount = 0
    let manager = GhosttyGlobalKeybindManager(
      isAccessibilityTrusted: { false },
      requestAccessibilityTrust: { requestCount += 1 },
      makeEventTapRegistration: {
        registrationCount += 1
        return FakeGhosttyGlobalEventTapRegistration()
      },
      runtimes: { [runtime] }
    )

    manager.refresh()
    manager.disable()

    #expect(!manager.isEnabled)
    #expect(requestCount == 1)
    #expect(registrationCount == 0)
  }

  @Test
  func refreshRetriesEventTapAfterAccessibilityIsGranted() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    var trusted = false
    let manager = GhosttyGlobalKeybindManager(
      isAccessibilityTrusted: { trusted },
      requestAccessibilityTrust: { trusted = true },
      makeEventTapRegistration: { FakeGhosttyGlobalEventTapRegistration() },
      runtimes: { [runtime] }
    )

    manager.refresh()
    manager.refresh()

    #expect(manager.isEnabled)
  }

  @Test
  func handleIgnoresEventsWhileAppIsActive() throws {
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    let manager = GhosttyGlobalKeybindManager(
      isAppActive: { true },
      runtimes: { [runtime] }
    )
    let event = try toggleVisibilityKeyEvent()

    #expect(!manager.handle(event))
  }

  @Test
  func handleDispatchesGlobalEventWhenAppIsInactive() throws {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }
    let runtime = try makeGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    let manager = GhosttyGlobalKeybindManager(
      isAppActive: { false },
      runtimes: { [runtime] }
    )
    let event = try toggleVisibilityKeyEvent()

    #expect(manager.handle(event))
    #expect(delegate.toggleVisibilityCount == 1)
  }
}

private func toggleVisibilityKeyEvent() throws -> GhosttyGlobalKeyEvent {
  try GhosttyGlobalKeyEvent(#require(
    NSEvent.keyEvent(
      with: .keyDown,
      location: .zero,
      modifierFlags: [.command, .shift],
      timestamp: 0,
      windowNumber: 0,
      context: nil,
      characters: ")",
      charactersIgnoringModifiers: "0",
      isARepeat: false,
      keyCode: UInt16(kVK_ANSI_0)
    )
  ))
}

private final class FakeGhosttyGlobalEventTapRegistration: GhosttyGlobalEventTapRegistration {
  nonisolated(unsafe) var invalidated = false

  nonisolated func invalidate() {
    invalidated = true
  }
}
