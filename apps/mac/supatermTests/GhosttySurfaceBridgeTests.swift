import AppKit
import GhosttyKit
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct GhosttySurfaceBridgeTests {
  @Test
  func openUrlRequestPreservesHTTPSURL() {
    let request = withOpenURLAction(url: "https://supaterm.com/changelog") {
      ghosttyOpenURLRequest(from: $0.action.open_url)
    }

    #expect(request?.kind == .unknown)
    #expect(request?.url.absoluteString == "https://supaterm.com/changelog")
    #expect(request?.url.isFileURL == false)
  }

  @Test
  func openUrlRequestTreatsTildePathAsFileURL() {
    let request = withOpenURLAction(url: "~/code/github.com/supabitapp/supaterm") {
      ghosttyOpenURLRequest(from: $0.action.open_url)
    }

    #expect(request?.url.isFileURL == true)
    #expect(request?.url.path == NSString(string: "~/code/github.com/supabitapp/supaterm").standardizingPath)
  }

  @Test
  func openUrlRequestTreatsPlainPathWithSpacesAsFileURL() {
    let request = withOpenURLAction(
      url: "/tmp/supa term/output.txt",
      kind: GHOSTTY_ACTION_OPEN_URL_KIND_TEXT
    ) {
      ghosttyOpenURLRequest(from: $0.action.open_url)
    }

    #expect(request?.kind == .text)
    #expect(request?.url.isFileURL == true)
    #expect(request?.url.path == "/tmp/supa term/output.txt")
  }

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
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    let action = ghostty_action_s(tag: GHOSTTY_ACTION_OPEN_CONFIG, action: ghostty_action_u())

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

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    let action = ghostty_action_s(tag: GHOSTTY_ACTION_TOGGLE_COMMAND_PALETTE, action: ghostty_action_u())

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

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_PROMPT_TITLE, action: ghostty_action_u())
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

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_PROMPT_TITLE, action: ghostty_action_u())
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

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_SET_TITLE, action: ghostty_action_u())
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

  @Test
  func openUrlReturnsHandledResult() {
    let bridge = GhosttySurfaceBridge()

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    withOpenURLAction(url: "not a valid url") { action in
      #expect(bridge.handleAction(target: target, action: action))
      #expect(bridge.state.openUrl == "not a valid url")
      #expect(bridge.state.openUrlKind == action.action.open_url.kind)
    }
  }

  private func withOpenURLAction<T>(
    url: String,
    kind: ghostty_action_open_url_kind_e = GHOSTTY_ACTION_OPEN_URL_KIND_UNKNOWN,
    _ body: (ghostty_action_s) -> T
  ) -> T {
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_OPEN_URL, action: ghostty_action_u())
    action.action.open_url.kind = kind
    guard let pointer = strdup(url) else {
      Issue.record("strdup failed")
      return body(action)
    }
    defer {
      free(pointer)
    }
    action.action.open_url.url = UnsafePointer(pointer)
    action.action.open_url.len = UInt(strlen(pointer))
    return body(action)
  }
}
