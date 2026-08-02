import AppKit
import Carbon.HIToolbox
import Darwin
import GhosttyKit
import SwiftUI
import Testing

@testable import supaterm

@Suite(.serialized)
struct GhosttySurfaceViewTests {
  init() {
    _ = NSApplication.shared
  }

  @Test
  func legacyScrollerFlashRequiresLegacyStyleAndMotionAllowance() {
    #expect(
      GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: true
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: true
      )
    )
  }

  @Test
  func reportedSurfaceSizeUsesScrollContentWidth() {
    #expect(
      GhosttySurfaceScrollView.reportedSurfaceSize(
        scrollContentSize: CGSize(width: 799, height: 600),
        surfaceFrameSize: CGSize(width: 816, height: 600)
      ) == CGSize(width: 799, height: 600)
    )
  }

  @Test
  @MainActor
  func wrapperSafeAreaInsetsAreZero() {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let wrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)

    #expect(wrapper.safeAreaInsets.top == 0)
    #expect(wrapper.safeAreaInsets.left == 0)
    #expect(wrapper.safeAreaInsets.bottom == 0)
    #expect(wrapper.safeAreaInsets.right == 0)
  }

  @Test
  @MainActor
  func surfaceLayoutsDoNotInvalidateWrapper() {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let wrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    wrapper.frame.size = CGSize(width: 800, height: 600)
    wrapper.layoutSubtreeIfNeeded()
    var invalidationCount = 0

    for _ in 0..<1_000 {
      wrapper.needsLayout = false
      surfaceView.layout()
      if wrapper.needsLayout {
        invalidationCount += 1
      }
    }

    #expect(invalidationCount == 0)
  }

  @Test
  @MainActor
  func failedSurfaceCreationPublishesFailure() {
    initializeGhosttyForTests()

    var creationCount = 0
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in
        creationCount += 1
        return nil
      }
    )

    #expect(creationCount == 1)
    #expect(surfaceView.surface == nil)
    #expect(surfaceView.bridge.state.failure == .surfaceCreationFailed)
  }

  @Test
  func unavailableProcessIdentityNormalizesZeroPIDAndEmptyTTY() {
    var freeCount = 0
    let identity = GhosttySurfaceView.processIdentity(
      foregroundProcessGroupID: { 0 },
      ttyName: { ghostty_string_s(ptr: nil, len: 0, sentinel: false) },
      freeString: { _ in freeCount += 1 }
    )

    #expect(identity.foregroundProcessGroupID == nil)
    #expect(identity.ttyName == nil)
    #expect(freeCount == 1)
  }

  @Test
  func processIdentityReadsAndFreesOwnedTTY() {
    let bytes = Array("/dev/ttys001".utf8CString)
    let pointer = UnsafeMutablePointer<CChar>.allocate(capacity: bytes.count)
    pointer.initialize(from: bytes, count: bytes.count)
    var freeCount = 0

    let identity = GhosttySurfaceView.processIdentity(
      foregroundProcessGroupID: { 42 },
      ttyName: {
        ghostty_string_s(
          ptr: UnsafePointer(pointer),
          len: UInt(bytes.count - 1),
          sentinel: true
        )
      },
      freeString: { value in
        #expect(value.ptr == UnsafePointer(pointer))
        pointer.deallocate()
        freeCount += 1
      }
    )

    #expect(
      identity
        == TerminalPaneProcessIdentity(
          foregroundProcessGroupID: 42,
          ttyName: "/dev/ttys001"
        )
    )
    #expect(freeCount == 1)
  }

  @Test
  func processIdentityReadsFreshValues() {
    var nextProcessID: UInt64 = 40
    var freeCount = 0
    let readIdentity = {
      GhosttySurfaceView.processIdentity(
        foregroundProcessGroupID: {
          nextProcessID += 1
          return nextProcessID
        },
        ttyName: { ghostty_string_s(ptr: nil, len: 0, sentinel: false) },
        freeString: { _ in freeCount += 1 }
      )
    }

    #expect(readIdentity().foregroundProcessGroupID == 41)
    #expect(readIdentity().foregroundProcessGroupID == 42)
    #expect(freeCount == 2)
  }

  @Test
  @MainActor
  func liveProcessIdentityOwnsEachTTYRead() async throws {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }

    let identity = try #require(
      try await waitForProcessIdentity(surfaceView, attempts: 100) { $0.ttyName != nil }
    )
    #expect(identity.ttyName?.hasPrefix("/dev/") == true)
    for _ in 0..<1_000 {
      #expect(surfaceView.processIdentity.ttyName?.hasPrefix("/dev/") == true)
    }
  }

  @Test
  @MainActor
  func liveProcessIdentityTracksShellForegroundChildAndExit() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
    host.ensureInitialTab(focusing: false)
    let surface = try #require(host.selectedSurfaceView)
    defer { surface.closeSurface() }

    let shell = try #require(
      try await waitForProcessIdentity(surface) {
        $0.foregroundProcessGroupID != nil && $0.ttyName != nil
      }
    )
    let shellProcessGroupID = try #require(shell.foregroundProcessGroupID)
    #expect(host.paneForegroundProcessGroupID(for: surface.id) == shellProcessGroupID)

    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-process-identity-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let childPIDURL = directory.appendingPathComponent("child.pid")
    surface.bridge.submitText(
      "/bin/sh -c 'ps -o pgid= -p $$ > \(childPIDURL.path); exec /bin/sleep 120'"
    )

    let foregroundChildProcessGroupID = try #require(try await waitForProcessID(at: childPIDURL))
    let child = try #require(
      try await waitForProcessIdentity(surface) {
        $0.foregroundProcessGroupID == foregroundChildProcessGroupID
      }
    )
    #expect(child.ttyName == shell.ttyName)

    #expect(Darwin.kill(-foregroundChildProcessGroupID, SIGTERM) == 0)
    let postExit = try #require(
      try await waitForProcessIdentity(surface) {
        $0.foregroundProcessGroupID != foregroundChildProcessGroupID
      }
    )
    #expect(postExit.foregroundProcessGroupID != foregroundChildProcessGroupID)
    #expect(postExit.ttyName == shell.ttyName)
  }

  @Test
  @MainActor
  func closePaneBindingReachesGhosttyCloseCallback() throws {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime("confirm-close-surface = false"),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }
    var processAlive: Bool?
    surfaceView.bridge.onCloseRequest = {
      processAlive = $0
    }

    surfaceView.closePane(nil)

    #expect(processAlive == false)
  }

  @Test
  @MainActor
  func focusedKeyInputAdvancesUserInputGeneration() throws {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }
    surfaceView.focusDidChange(true)
    let event = try #require(
      NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: [],
        timestamp: 0,
        windowNumber: 0,
        context: nil,
        characters: "a",
        charactersIgnoringModifiers: "a",
        isARepeat: false,
        keyCode: 0
      )
    )

    surfaceView.keyDown(with: event)

    #expect(surfaceView.bridge.state.userInputGeneration == 1)
  }

  @Test
  @MainActor
  func commandArrowOverridesUseGhosttyBindings() throws {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }
    let runtime = try makeGhosttyRuntime(
      """
      keybind = super+up=new_tab
      keybind = super+down=new_window
      """
    )

    try withFocusedSurface(runtime: runtime) { surfaceView, window in
      var newTabCount = 0
      surfaceView.bridge.onNewTab = {
        newTabCount += 1
        return true
      }

      try sendCommandKey(
        keyCode: kVK_UpArrow,
        characters: "\u{F700}",
        window: window
      )
      try sendCommandKey(
        keyCode: kVK_DownArrow,
        characters: "\u{F701}",
        window: window
      )

      #expect(newTabCount == 1)
      #expect(delegate.newWindowCount == 1)
    }
  }

  @Test
  @MainActor
  func defaultCommandArrowBindingsReachGhostty() throws {
    let runtime = try makeGhosttyRuntime("")

    try withFocusedSurface(runtime: runtime) { surfaceView, window in
      try sendCommandKey(
        keyCode: kVK_UpArrow,
        characters: "\u{F700}",
        window: window
      )
      try sendCommandKey(
        keyCode: kVK_DownArrow,
        characters: "\u{F701}",
        window: window
      )

      #expect(surfaceView.bridge.state.userInputGeneration == 2)
    }
  }

  @Test
  @MainActor
  func appKitTextInputCommandReachesGhostty() throws {
    let runtime = try makeGhosttyRuntime("")

    try withFocusedSurface(runtime: runtime) { surfaceView, window in
      try sendCommandKey(
        keyCode: kVK_ANSI_Period,
        characters: ".",
        window: window
      )

      #expect(surfaceView.bridge.state.userInputGeneration == 1)
    }
  }

  @Test
  @MainActor
  func homeAndEndPreserveDocumentScrolling() throws {
    let home = try makeKeyEvent(
      keyCode: kVK_Home,
      characters: "\u{F729}",
      modifierFlags: []
    )
    let end = try makeKeyEvent(
      keyCode: kVK_End,
      characters: "\u{F72B}",
      modifierFlags: []
    )

    #expect(
      GhosttySurfaceView.appKitDocumentBindingAction(
        for: #selector(NSResponder.moveToBeginningOfDocument(_:)),
        event: home
      ) == "scroll_to_top"
    )
    #expect(
      GhosttySurfaceView.appKitDocumentBindingAction(
        for: #selector(NSResponder.moveToEndOfDocument(_:)),
        event: end
      ) == "scroll_to_bottom"
    )
  }

  @Test
  @MainActor
  func koreanArrowCommitUsesTextOnlyInputAndReplaysOnlyUnconsumedArrows() throws {
    GhosttySurfaceView.withCommittedPreeditKey(
      action: GHOSTTY_ACTION_PRESS,
      text: "한"
    ) { key in
      #expect(key.action == GHOSTTY_ACTION_PRESS)
      #expect(key.keycode == 0)
      #expect(key.text.map { String(cString: $0) } == "한")
      #expect(key.composing == false)
      #expect(key.mods == GHOSTTY_MODS_NONE)
      #expect(key.consumed_mods == GHOSTTY_MODS_NONE)
      #expect(key.unshifted_codepoint == 0)
    }

    let down = try keyDownEvent(keyCode: kVK_DownArrow)
    let right = try keyDownEvent(keyCode: kVK_RightArrow)
    let up = try keyDownEvent(keyCode: kVK_UpArrow)
    let left = try keyDownEvent(keyCode: kVK_LeftArrow)
    let modifiedLeft = try keyDownEvent(keyCode: kVK_LeftArrow, modifierFlags: .control)
    let letter = try keyDownEvent(keyCode: kVK_ANSI_A)

    #expect(GhosttySurfaceView.shouldReplayCommittedPreeditKey(down))
    #expect(GhosttySurfaceView.shouldReplayCommittedPreeditKey(right))
    #expect(GhosttySurfaceView.shouldReplayCommittedPreeditKey(up))
    #expect(!GhosttySurfaceView.shouldReplayCommittedPreeditKey(left))
    #expect(GhosttySurfaceView.shouldReplayCommittedPreeditKey(modifiedLeft))
    #expect(!GhosttySurfaceView.shouldReplayCommittedPreeditKey(letter))
  }

  @Test
  @MainActor
  func japaneseComposingControlHIsSuppressed() {
    #expect(
      GhosttySurfaceView.shouldSuppressComposingControlInput(
        "\u{0008}",
        composing: true
      )
    )
    #expect(
      !GhosttySurfaceView.shouldSuppressComposingControlInput(
        "\u{0008}",
        composing: false
      )
    )
  }

  @Test
  @MainActor
  func surfaceCreationReceivesUnbackedView() {
    initializeGhosttyForTests()

    var wantsLayerAtCreation: Bool?
    var hasLayerAtCreation: Bool?
    _ = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, config in
        guard let pointer = config.pointee.platform.macos.nsview else { return nil }
        let surfaceView = Unmanaged<GhosttySurfaceView>.fromOpaque(pointer).takeUnretainedValue()
        wantsLayerAtCreation = surfaceView.wantsLayer
        hasLayerAtCreation = surfaceView.layer != nil
        return nil
      }
    )

    #expect(wantsLayerAtCreation == false)
    #expect(hasLayerAtCreation == false)
  }

  @Test
  @MainActor
  func searchOverlayUpdateDoesNotStealFocusAfterSplit() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(runtime: GhosttyRuntime())
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    let sourceSurface = try #require(host.selectedSurfaceView)
    sourceSurface.bridge.state.searchNeedle = ""
    sourceSurface.bridge.state.searchFocusCount = 1

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )

    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    let overlay = NSHostingView(
      rootView: GhosttySurfaceSearchOverlay(surfaceView: sourceSurface)
    )
    sourceSurface.frame = container.bounds
    overlay.frame = container.bounds
    window.contentView = container
    container.addSubview(sourceSurface)
    container.addSubview(overlay)
    window.makeKeyAndOrderFront(nil)

    let searchField = try await searchField(in: container)
    window.makeFirstResponder(searchField)
    try #require(
      window.firstResponder === searchField || window.firstResponder === searchField.currentEditor()
    )

    #expect(host.performSplitAction(.newSplit(direction: .right), for: sourceSurface.id))
    let targetSurface = try #require(host.selectedSurfaceView)
    #expect(targetSurface !== sourceSurface)
    targetSurface.frame = container.bounds
    container.addSubview(targetSurface)
    await Task.yield()
    await Task.yield()

    #expect(window.firstResponder === targetSurface)

    overlay.removeFromSuperview()
    let rebuiltOverlay = NSHostingView(
      rootView: GhosttySurfaceSearchOverlay(surfaceView: sourceSurface)
    )
    rebuiltOverlay.frame = container.bounds
    container.addSubview(rebuiltOverlay)
    try? await Task.sleep(for: .milliseconds(50))

    #expect(window.firstResponder === targetSurface)
  }

  @Test
  @MainActor
  func syncFocusRestoresSurfaceFirstResponderFromPassiveWindowView() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
    host.ensureInitialTab(focusing: false)
    let surface = try #require(host.selectedSurfaceView)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let wrapper = FocusableWrapperView(frame: window.contentView?.bounds ?? .zero)
    wrapper.addSubview(surface)
    window.contentView = wrapper
    window.makeFirstResponder(wrapper)

    try #require(window.firstResponder === wrapper)

    host.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))
    await Task.yield()

    #expect(window.firstResponder === surface)
  }

  @Test
  @MainActor
  func syncFocusDoesNotRestoreSurfaceFirstResponderFromTextInput() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
    host.ensureInitialTab(focusing: false)
    let surface = try #require(host.selectedSurfaceView)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 120, height: 24))
    let wrapper = FocusableWrapperView(frame: window.contentView?.bounds ?? .zero)
    wrapper.addSubview(surface)
    wrapper.addSubview(textField)
    window.contentView = wrapper
    window.makeFirstResponder(textField)

    host.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))
    await Task.yield()

    #expect(window.firstResponder !== surface)
  }

  @Test
  @MainActor
  func newerFocusRequestSupersedesDeferredSurfaceFocus() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
    host.ensureInitialTab(focusing: false)
    let tabID = try #require(host.selectedTabID)
    let source = try #require(host.selectedSurfaceView)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    source.frame = container.bounds
    window.contentView = container
    container.addSubview(source)
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(source)

    #expect(host.performSplitAction(.newSplit(direction: .right), for: source.id))
    let split = try #require(host.selectedSurfaceView)
    #expect(split !== source)

    host.focusSurface(source, in: tabID)
    split.frame = container.bounds
    container.addSubview(split)
    try await Task.sleep(for: .milliseconds(100))

    #expect(host.selectedSurfaceView === source)
    #expect(window.firstResponder === source)
  }

  @Test
  @MainActor
  func nonKeyFirstResponderDoesNotOverrideDeferredSurfaceFocus() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
    host.ensureInitialTab(focusing: false)
    let source = try #require(host.selectedSurfaceView)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = FocusableWrapperView(frame: window.contentView?.bounds ?? .zero)
    source.frame = container.bounds
    window.contentView = container
    container.addSubview(source)
    window.makeFirstResponder(container)

    #expect(!window.isKeyWindow)
    #expect(host.performSplitAction(.newSplit(direction: .right), for: source.id))
    let split = try #require(host.selectedSurfaceView)
    #expect(split !== source)

    window.makeFirstResponder(source)
    #expect(window.firstResponder === source)
    #expect(host.selectedSurfaceView === split)

    split.frame = container.bounds
    container.addSubview(split)
    try await Task.sleep(for: .milliseconds(100))

    #expect(host.selectedSurfaceView === split)
    #expect(window.firstResponder === split)
  }

  @Test
  @MainActor
  func clickingUnfocusedSplitTransfersFocusWithoutDirectInteraction() throws {
    initializeGhosttyForTests()

    let app = NSApplication.shared
    let runtime = try makeGhosttyRuntime("", applicationIsActive: { false })
    let firstSurface = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let secondSurface = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      applicationAndWindowAreActive: { _ in true }
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 200),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    firstSurface.frame = NSRect(x: 0, y: 0, width: 200, height: 200)
    secondSurface.frame = NSRect(x: 200, y: 0, width: 200, height: 200)
    window.contentView = container
    container.addSubview(firstSurface)
    container.addSubview(secondSurface)
    defer {
      firstSurface.closeSurface()
      secondSurface.closeSurface()
      window.contentView = nil
      window.orderOut(nil)
    }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(firstSurface)
    var directInteractionCount = 0
    secondSurface.onDirectInteraction = {
      directInteractionCount += 1
    }
    let locationInWindow = secondSurface.convert(
      NSPoint(x: secondSurface.bounds.midX, y: secondSurface.bounds.midY),
      to: nil
    )
    let event = try #require(
      NSEvent.mouseEvent(
        with: .leftMouseDown,
        location: locationInWindow,
        modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber,
        context: nil,
        eventNumber: 1,
        clickCount: 1,
        pressure: 1
      )
    )
    try #require(event.window === window)
    try #require(
      container.hitTest(container.convert(event.locationInWindow, from: nil)) === secondSurface
    )

    app.sendEvent(event)

    #expect(window.firstResponder === secondSurface)
    #expect(directInteractionCount == 0)
  }
}

@MainActor
private func keyDownEvent(
  keyCode: Int,
  modifierFlags: NSEvent.ModifierFlags = []
) throws -> NSEvent {
  try #require(
    NSEvent.keyEvent(
      with: .keyDown,
      location: .zero,
      modifierFlags: modifierFlags,
      timestamp: 0,
      windowNumber: 0,
      context: nil,
      characters: "",
      charactersIgnoringModifiers: "",
      isARepeat: false,
      keyCode: UInt16(keyCode)
    )
  )
}

private final class FocusableWrapperView: NSView {
  override var acceptsFirstResponder: Bool { true }
}

@MainActor
private func withFocusedSurface(
  runtime: GhosttyRuntime,
  perform body: (GhosttySurfaceView, NSWindow) throws -> Void
) rethrows {
  let surfaceView = GhosttySurfaceView(
    runtime: runtime,
    tabID: UUID(),
    workingDirectory: nil,
    context: GHOSTTY_SURFACE_CONTEXT_TAB
  )
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
    styleMask: [.titled],
    backing: .buffered,
    defer: false
  )
  window.contentView = surfaceView
  window.makeKeyAndOrderFront(nil)
  window.makeFirstResponder(surfaceView)
  surfaceView.focusDidChange(true)
  defer {
    surfaceView.closeSurface()
    window.contentView = nil
    window.orderOut(nil)
  }

  try body(surfaceView, window)
}

@MainActor
private func sendCommandKey(
  keyCode: Int,
  characters: String,
  window: NSWindow
) throws {
  NSApp.sendEvent(
    try makeKeyEvent(
      keyCode: keyCode,
      characters: characters,
      modifierFlags: .command,
      windowNumber: window.windowNumber
    )
  )
}

private func makeKeyEvent(
  keyCode: Int,
  characters: String,
  modifierFlags: NSEvent.ModifierFlags,
  windowNumber: Int = 0
) throws -> NSEvent {
  try #require(
    NSEvent.keyEvent(
      with: .keyDown,
      location: .zero,
      modifierFlags: modifierFlags,
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: windowNumber,
      context: nil,
      characters: characters,
      charactersIgnoringModifiers: characters,
      isARepeat: false,
      keyCode: UInt16(keyCode)
    )
  )
}

@MainActor
private func searchField(in root: NSView) async throws -> NSTextField {
  for _ in 0..<5 {
    root.layoutSubtreeIfNeeded()
    if let field = findSearchField(in: root) {
      return field
    }
    await Task.yield()
  }
  return try #require(findSearchField(in: root))
}

@MainActor
private func findSearchField(in root: NSView) -> NSTextField? {
  if let field = root as? NSTextField, field.placeholderString == "Search" {
    return field
  }
  for subview in root.subviews {
    if let field = findSearchField(in: subview) {
      return field
    }
  }
  return nil
}

@MainActor
private func waitForProcessIdentity(
  _ surface: GhosttySurfaceView,
  attempts: Int = 300,
  matching predicate: (TerminalPaneProcessIdentity) -> Bool
) async throws -> TerminalPaneProcessIdentity? {
  for _ in 0..<attempts {
    let identity = surface.processIdentity
    if predicate(identity) {
      return identity
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  return nil
}

private func waitForProcessID(at url: URL) async throws -> Int32? {
  for _ in 0..<300 {
    if let value = try? String(contentsOf: url, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines),
      let processID = Int32(value)
    {
      return processID
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  return nil
}
