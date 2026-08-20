import AppKit
import GhosttyKit
import Testing

@testable import supaterm

struct GhosttyKeyEventTests {
  @Test
  @MainActor
  func derivesCharactersOnlyForKeyDown() throws {
    let keyDown = try keyEvent(type: .keyDown)
    let keyUp = try keyEvent(type: .keyUp)
    let flagsChanged = try keyEvent(type: .flagsChanged, modifierFlags: .shift)

    #expect(GhosttyKeyEvent.characters(keyDown) == "a")
    #expect(GhosttyKeyEvent.characters(keyUp) == nil)
    #expect(GhosttyKeyEvent.characters(flagsChanged) == nil)
  }

  @Test
  @MainActor
  func modifierTranslationDoesNotReadCharacters() throws {
    initializeGhosttyForTests()
    let surfaceView = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime("macos-option-as-alt = true"),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }

    surfaceView.flagsChanged(
      with: try keyEvent(type: .flagsChanged, modifierFlags: .option, keyCode: 0x3A)
    )
  }

  @MainActor
  private func keyEvent(
    type: NSEvent.EventType,
    modifierFlags: NSEvent.ModifierFlags = [],
    keyCode: UInt16 = 0
  ) throws -> NSEvent {
    try #require(
      NSEvent.keyEvent(
        with: type,
        location: .zero,
        modifierFlags: modifierFlags,
        timestamp: 0,
        windowNumber: 0,
        context: nil,
        characters: "a",
        charactersIgnoringModifiers: "a",
        isARepeat: false,
        keyCode: keyCode
      )
    )
  }
}
