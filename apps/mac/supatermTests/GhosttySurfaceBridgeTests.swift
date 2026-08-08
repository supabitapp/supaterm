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
  func openUrlRequestRecognizesOSC8Targets() {
    let request = withOpenURLAction(
      url: "https://supaterm.com/docs",
      kind: GHOSTTY_ACTION_OPEN_URL_KIND_OSC8
    ) {
      ghosttyOpenURLRequest(from: $0.action.open_url)
    }

    #expect(request?.kind == .osc8)
    #expect(request?.value == "https://supaterm.com/docs")
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
  func emptySearchRestoresFindPasteboardNeedle() {
    let pasteboard = makeFindPasteboard("restored")
    let bridge = GhosttySurfaceBridge(findPasteboard: pasteboard)

    withStartSearchAction(needle: "") { action in
      #expect(bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }

    #expect(bridge.state.searchNeedle == "restored")
    #expect(bridge.state.searchFocusCount == 1)
    #expect(bridge.state.searchSelectionRequestCount == 1)
  }

  @Test
  func nonEmptySearchWritesFindPasteboardNeedle() {
    let pasteboard = makeFindPasteboard("old")
    let bridge = GhosttySurfaceBridge(findPasteboard: pasteboard)

    withStartSearchAction(needle: "new") { action in
      #expect(bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }

    #expect(bridge.state.searchNeedle == "new")
    #expect(pasteboard.string(forType: .string) == "new")
    #expect(bridge.state.searchSelectionRequestCount == 0)
  }

  @Test
  func repeatedExplicitSearchReassertsFindPasteboardNeedle() {
    let pasteboard = makeFindPasteboard("other")
    let bridge = GhosttySurfaceBridge(findPasteboard: pasteboard)
    bridge.state.searchNeedle = "same"

    withStartSearchAction(needle: "same") { action in
      #expect(bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }

    #expect(bridge.state.searchNeedle == "same")
    #expect(pasteboard.string(forType: .string) == "same")
  }

  @Test
  func changedSearchNeedleWritesFindPasteboard() {
    let pasteboard = makeFindPasteboard()
    let bridge = GhosttySurfaceBridge(findPasteboard: pasteboard)
    bridge.state.searchNeedle = "before"

    bridge.setSearchNeedle("after")

    #expect(bridge.state.searchNeedle == "after")
    #expect(pasteboard.string(forType: .string) == "after")
  }

  @Test
  func activationRestoreUpdatesNeedleAndRequestsSelection() {
    let pasteboard = makeFindPasteboard("before")
    let bridge = GhosttySurfaceBridge(findPasteboard: pasteboard)
    bridge.state.searchNeedle = "before"
    replaceFindPasteboard(pasteboard, with: "after")

    bridge.restoreSearchNeedle()

    #expect(bridge.state.searchNeedle == "after")
    #expect(bridge.state.searchSelectionRequestCount == 1)
  }

  @Test
  func sharedFindPasteboardDoesNotShareLiveSearchState() {
    let pasteboard = makeFindPasteboard()
    let firstBridge = GhosttySurfaceBridge(findPasteboard: pasteboard)
    let secondBridge = GhosttySurfaceBridge(findPasteboard: pasteboard)
    firstBridge.state.searchNeedle = "first"
    secondBridge.state.searchNeedle = "second"

    firstBridge.setSearchNeedle("updated")

    #expect(firstBridge.state.searchNeedle == "updated")
    #expect(secondBridge.state.searchNeedle == "second")
    #expect(pasteboard.string(forType: .string) == "updated")
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
  func selectionChangedWithoutSurfaceViewIsHarmless() {
    let bridge = GhosttySurfaceBridge()
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    let action = ghostty_action_s(tag: GHOSTTY_ACTION_SELECTION_CHANGED, action: ghostty_action_u())

    #expect(!bridge.handleAction(target: target, action: action))
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

    #expect(bridge.handleAction(target: target, action: action))
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

    #expect(bridge.handleAction(target: target, action: action))
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

    #expect(bridge.handleAction(target: target, action: action))
    #expect(bridge.state.title == "sleep 10")
    #expect(bridge.state.titleOverride == "Pinned")
    #expect(emittedTitles.isEmpty)
  }

  @Test
  func openUrlReturnsHandledResult() {
    var openedURL: URL?
    let bridge = GhosttySurfaceBridge {
      openedURL = $0
      return true
    }

    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    withOpenURLAction(url: "https://supaterm.com/docs") { action in
      #expect(bridge.handleAction(target: target, action: action))
      #expect(openedURL?.absoluteString == "https://supaterm.com/docs")
    }
  }

  @Test
  func openUrlReturnsOpeningResult() {
    let bridge = GhosttySurfaceBridge { _ in false }

    withOpenURLAction(url: "https://supaterm.com/docs") { action in
      #expect(!bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }
  }

  @Test
  func osc8OpenUrlStaysHandledWhenOpeningFails() {
    var openedURL: URL?
    let bridge = GhosttySurfaceBridge {
      openedURL = $0
      return false
    }

    withOpenURLAction(
      url: "https://supaterm.com/docs",
      kind: GHOSTTY_ACTION_OPEN_URL_KIND_OSC8
    ) { action in
      #expect(bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
      #expect(openedURL?.absoluteString == "https://supaterm.com/docs")
    }
  }

  @Test
  func malformedOsc8OpenUrlStaysHandled() {
    let bridge = GhosttySurfaceBridge { _ in
      Issue.record("malformed OSC 8 target should not open")
      return true
    }
    let byte = UnsafeMutablePointer<CChar>.allocate(capacity: 1)
    byte.initialize(to: CChar(bitPattern: 0xFF))
    defer {
      byte.deinitialize(count: 1)
      byte.deallocate()
    }
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_OPEN_URL, action: ghostty_action_u())
    action.action.open_url.kind = GHOSTTY_ACTION_OPEN_URL_KIND_OSC8
    action.action.open_url.url = UnsafePointer(byte)
    action.action.open_url.len = 1

    #expect(bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
  }

  @Test
  func handledActionsReturnTrue() {
    let bridge = GhosttySurfaceBridge()
    let tags = [GHOSTTY_ACTION_RING_BELL]

    for tag in tags {
      let action = ghostty_action_s(tag: tag, action: ghostty_action_u())
      #expect(bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }
  }

  @Test
  func actionsWithoutEffectsReturnFalse() {
    let bridge = GhosttySurfaceBridge()
    let tags = [
      GHOSTTY_ACTION_COLOR_CHANGE,
      GHOSTTY_ACTION_CONFIG_CHANGE,
      GHOSTTY_ACTION_SIZE_LIMIT,
      GHOSTTY_ACTION_INITIAL_SIZE,
      GHOSTTY_ACTION_RESET_WINDOW_SIZE,
      GHOSTTY_ACTION_FLOAT_WINDOW,
      GHOSTTY_ACTION_PRESENT_TERMINAL,
      GHOSTTY_ACTION_QUIT_TIMER,
    ]

    for tag in tags {
      let action = ghostty_action_s(tag: tag, action: ghostty_action_u())
      #expect(!bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }
  }

  @Test
  func undoAndRedoReturnResponderResults() {
    var selectors: [Selector] = []
    let bridge = GhosttySurfaceBridge(sendAction: {
      selectors.append($0)
      return false
    })

    for tag in [GHOSTTY_ACTION_UNDO, GHOSTTY_ACTION_REDO] {
      let action = ghostty_action_s(tag: tag, action: ghostty_action_u())
      #expect(!bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }

    #expect(selectors == [#selector(UndoManager.undo), #selector(UndoManager.redo)])
  }

  @Test
  func viewActionsWithoutSurfaceViewReturnFalse() {
    let bridge = GhosttySurfaceBridge()
    let tags = [
      GHOSTTY_ACTION_SELECTION_CHANGED,
      GHOSTTY_ACTION_MOUSE_SHAPE,
      GHOSTTY_ACTION_MOUSE_VISIBILITY,
      GHOSTTY_ACTION_SCROLLBAR,
      GHOSTTY_ACTION_CELL_SIZE,
      GHOSTTY_ACTION_SECURE_INPUT,
    ]

    for tag in tags {
      let action = ghostty_action_s(tag: tag, action: ghostty_action_u())
      #expect(!bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }
  }

  @Test
  func mouseOverLinkActionSetsAndClearsHoveredLink() {
    let bridge = GhosttySurfaceBridge()
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())

    withMouseOverLinkAction(url: "https://supaterm.com/docs") { action in
      #expect(bridge.handleAction(target: target, action: action))
      #expect(bridge.state.mouseOverLink == "https://supaterm.com/docs")
    }

    withMouseOverLinkAction(url: "") { action in
      #expect(bridge.handleAction(target: target, action: action))
      #expect(bridge.state.mouseOverLink == nil)
    }
  }

  @Test
  func nonvisibleSurfaceClearsHoveredLink() {
    let bridge = GhosttySurfaceBridge()
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())

    withMouseOverLinkAction(url: "https://supaterm.com/docs") { action in
      _ = bridge.handleAction(target: target, action: action)
    }

    bridge.clearMouseOverLink()

    #expect(bridge.state.mouseOverLink == nil)
  }

  @Test
  func unhealthyRendererExposesRendererUnavailableFailure() {
    let bridge = GhosttySurfaceBridge()
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_RENDERER_HEALTH, action: ghostty_action_u())
    action.action.renderer_health = GHOSTTY_RENDERER_HEALTH_UNHEALTHY

    #expect(bridge.handleAction(target: target, action: action))
    #expect(bridge.state.failure == .rendererUnavailable)
  }

  @Test
  func healthyRendererClearsRendererUnavailableFailure() {
    let bridge = GhosttySurfaceBridge()
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_RENDERER_HEALTH, action: ghostty_action_u())
    action.action.renderer_health = GHOSTTY_RENDERER_HEALTH_UNHEALTHY
    _ = bridge.handleAction(target: target, action: action)

    action.action.renderer_health = GHOSTTY_RENDERER_HEALTH_HEALTHY
    #expect(bridge.handleAction(target: target, action: action))
    #expect(bridge.state.failure == nil)
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

  private func withMouseOverLinkAction<T>(
    url: String,
    _ body: (ghostty_action_s) -> T
  ) -> T {
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_MOUSE_OVER_LINK, action: ghostty_action_u())
    guard let pointer = strdup(url) else {
      Issue.record("strdup failed")
      return body(action)
    }
    defer {
      free(pointer)
    }
    action.action.mouse_over_link.url = UnsafePointer(pointer)
    action.action.mouse_over_link.len = strlen(pointer)
    return body(action)
  }
}
