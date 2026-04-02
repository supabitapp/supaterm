import AppKit
import GhosttyKit
import Testing

@testable import supaterm

@MainActor
struct GhosttySurfaceBridgeTests {
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
  func promptTitleEmitsCallback() {
    let bridge = GhosttySurfaceBridge()
    var received: ghostty_action_prompt_title_e?
    bridge.onPromptTitle = { prompt in
      received = prompt
    }

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: .init())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_PROMPT_TITLE, action: .init())
    action.action.prompt_title = GHOSTTY_PROMPT_TITLE_SURFACE

    #expect(bridge.handleAction(target: target, action: action) == false)
    #expect(received == GHOSTTY_PROMPT_TITLE_SURFACE)
  }
}
