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
      runtime: runtime,
      isAccessibilityTrusted: { true },
      requestAccessibilityTrust: { requestCount += 1 },
      makeEventTapRegistration: { _ in
        registrationCount += 1
        return registration
      }
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
  func configReloadDisablesEventTapForSameRuntime() async throws {
    let fixture = try makePersistentGhosttyRuntime(
      """
      keybind = global:super+shift+0=toggle_visibility
      """
    )
    defer { fixture.cleanup() }
    let registration = FakeGhosttyGlobalEventTapRegistration()
    let manager = GhosttyGlobalKeybindManager(
      runtime: fixture.runtime,
      isAccessibilityTrusted: { true },
      makeEventTapRegistration: { _ in registration }
    )
    manager.refresh()
    try #require(manager.isEnabled)

    try "keybind = super+shift+0=toggle_visibility\n"
      .write(to: fixture.configURL, atomically: true, encoding: .utf8)
    fixture.runtime.reloadAppConfig()
    for _ in 0..<5 {
      await Task.yield()
    }

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
      runtime: runtime,
      isAccessibilityTrusted: { false },
      requestAccessibilityTrust: { requestCount += 1 },
      makeEventTapRegistration: { _ in
        registrationCount += 1
        return FakeGhosttyGlobalEventTapRegistration()
      }
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
      runtime: runtime,
      isAccessibilityTrusted: { trusted },
      requestAccessibilityTrust: { trusted = true },
      makeEventTapRegistration: { _ in FakeGhosttyGlobalEventTapRegistration() }
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
      runtime: runtime,
      isAppActive: { true }
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
      runtime: runtime,
      isAppActive: { false }
    )
    let event = try toggleVisibilityKeyEvent()

    #expect(manager.handle(event))
    #expect(delegate.toggleVisibilityCount == 1)
  }

  @Test
  func eventTapRoutesThroughOwningManager() throws {
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
    var eventTapManager: GhosttyGlobalKeybindManager?
    let manager = GhosttyGlobalKeybindManager(
      runtime: runtime,
      isAccessibilityTrusted: { true },
      makeEventTapRegistration: { manager in
        eventTapManager = manager
        return FakeGhosttyGlobalEventTapRegistration()
      },
      isAppActive: { false }
    )

    manager.refresh()
    let routedManager = try #require(eventTapManager)

    #expect(routedManager === manager)
    #expect(routedManager.handle(try toggleVisibilityKeyEvent()))
    #expect(delegate.toggleVisibilityCount == 1)
  }
}

private func toggleVisibilityKeyEvent() throws -> GhosttyGlobalKeyEvent {
  try GhosttyGlobalKeyEvent(
    #require(
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
  var invalidated = false

  func invalidate() {
    invalidated = true
  }
}
