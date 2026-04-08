import AppKit
import GhosttyKit
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct GhosttySurfaceBridgeTests {
  @Test
  func inputChunksSplitControlScalarsIntoKeys() {
    #expect(
      ghosttyInputChunks("echo hello\r\u{03}tail\t\u{1B}\u{7F}\u{04}\u{0C}\u{1A}")
        == [
          .text("echo hello"),
          .key(.enter),
          .key(.ctrlC),
          .text("tail"),
          .key(.tab),
          .key(.escape),
          .key(.backspace),
          .key(.ctrlD),
          .key(.ctrlL),
          .key(.ctrlZ),
        ]
    )
  }

  @Test
  func openConfigUsesAppActionPerformer() {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    let bridge = GhosttySurfaceBridge()
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: .init())
    let action = ghostty_action_s(tag: GHOSTTY_ACTION_OPEN_CONFIG, action: .init())

    #expect(bridge.handleAction(target: target, action: action))
    #expect(delegate.openConfigCount == 1)
  }

  @Test
  func toggleCommandPaletteEmitsCallback() {
    let bridge = GhosttySurfaceBridge()
    var toggleCount = 0
    bridge.onCommandPaletteToggle = {
      toggleCount += 1
      return true
    }

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: .init())
    let action = ghostty_action_s(tag: GHOSTTY_ACTION_TOGGLE_COMMAND_PALETTE, action: .init())

    #expect(bridge.handleAction(target: target, action: action))
    #expect(toggleCount == 1)
  }

  @Test
  func promptSurfaceTitleEmitsCallback() {
    let bridge = GhosttySurfaceBridge()
    var promptSurfaceTitle = 0
    var promptTabTitle = 0
    bridge.onPromptSurfaceTitle = {
      promptSurfaceTitle += 1
    }
    bridge.onPromptTabTitle = {
      promptTabTitle += 1
    }

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: .init())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_PROMPT_TITLE, action: .init())
    action.action.prompt_title = GHOSTTY_PROMPT_TITLE_SURFACE

    #expect(bridge.handleAction(target: target, action: action) == false)
    #expect(promptSurfaceTitle == 1)
    #expect(promptTabTitle == 0)
  }

  @Test
  func promptTabTitleEmitsCallback() {
    let bridge = GhosttySurfaceBridge()
    var promptSurfaceTitle = 0
    var promptTabTitle = 0
    bridge.onPromptSurfaceTitle = {
      promptSurfaceTitle += 1
    }
    bridge.onPromptTabTitle = {
      promptTabTitle += 1
    }

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: .init())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_PROMPT_TITLE, action: .init())
    action.action.prompt_title = GHOSTTY_PROMPT_TITLE_TAB

    #expect(bridge.handleAction(target: target, action: action) == false)
    #expect(promptSurfaceTitle == 0)
    #expect(promptTabTitle == 1)
  }

  @Test
  func setTitleDoesNotClearManualTitleOverride() {
    let bridge = GhosttySurfaceBridge()
    bridge.state.titleOverride = "Pinned"
    var emittedTitles: [String] = []
    bridge.onTitleChange = { emittedTitles.append($0) }

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: .init())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_SET_TITLE, action: .init())
    let title = strdup("sleep 10")
    action.action.set_title.title = UnsafePointer(title)
    defer {
      free(title)
    }

    #expect(bridge.handleAction(target: target, action: action) == false)
    #expect(bridge.state.title == "sleep 10")
    #expect(bridge.state.titleOverride == "Pinned")
    #expect(emittedTitles.isEmpty)
  }
}
