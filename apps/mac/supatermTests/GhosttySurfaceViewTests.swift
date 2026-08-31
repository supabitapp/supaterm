import AppKit
import Carbon.HIToolbox
import Clocks
import Darwin
import GhosttyKit
import SwiftUI
import Testing

@testable import supaterm

@Suite(.serialized)
struct GhosttySurfaceViewTests {
  @Test
  func surrogateDecoderCombinesSplitUnicodeInput() {
    var decoder = UTF16SurrogateDecoder()
    let units = Array("😀".utf16)

    #expect(decoder.decode(NSString(characters: [units[0]], length: 1)).isEmpty)
    #expect(decoder.decode(NSString(characters: [units[1]], length: 1)) == "😀")
  }

  @Test
  func surrogateDecoderDropsUnpairedInput() {
    var decoder = UTF16SurrogateDecoder()
    let units = Array("😀".utf16)

    #expect(decoder.decode(NSString(characters: [units[1]], length: 1)).isEmpty)
    #expect(decoder.decode(NSString(characters: [units[0]], length: 1)).isEmpty)
    #expect(decoder.decode("x") == "x")
    #expect(decoder.decode(NSString(characters: [units[1]], length: 1)).isEmpty)
  }

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
  func cellSizeConvertsBackingPixelsToViewPoints() {
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
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
    window.contentView?.addSubview(surfaceView)
    defer { window.contentView = nil }
    let expected = CGSize(width: 10, height: 20)
    let backingSize = surfaceView.convertToBacking(expected)

    surfaceView.updateCellSize(
      width: UInt32(backingSize.width),
      height: UInt32(backingSize.height)
    )

    #expect(surfaceView.currentCellSize() == expected)
  }

  @Test
  @MainActor
  func surfaceConfigDrivesProgressAndScrollbarAppearance() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      background-opacity = 0.4
      scrollbar = never
      progress-style = false
      """
    )
    let surfaceView = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in nil }
    )
    let wrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    surfaceView.scrollWrapper = wrapper
    let scrollView = try #require(wrapper.subviews.compactMap { $0 as? NSScrollView }.first)

    #expect(surfaceView.bridge.state.derivedConfig.backgroundOpacity == 0.4)
    #expect(!surfaceView.bridge.state.progressStyleEnabled)
    #expect(!scrollView.hasVerticalScroller)
    #expect(scrollView.appearance?.name == .darkAqua)

    let colorAction = ghosttyColorChangeAction(
      kind: GHOSTTY_ACTION_COLOR_KIND_BACKGROUND,
      red: 244,
      green: 230,
      blue: 216
    )
    #expect(surfaceView.bridge.handleAction(target: ghosttySurfaceTarget(), action: colorAction))
    #expect(scrollView.appearance?.name == .darkAqua)

    try withConfigChangeAction(
      """
      background = #F4E6D8
      background-opacity = 0.8
      scrollbar = system
      progress-style = true
      """
    ) { action in
      #expect(surfaceView.bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }

    #expect(surfaceView.bridge.state.oscBackgroundColor != nil)
    #expect(surfaceView.bridge.state.derivedConfig.backgroundOpacity == 0.8)
    #expect(surfaceView.bridge.state.progressStyleEnabled)
    #expect(scrollView.hasVerticalScroller)
    #expect(scrollView.appearance?.name == .aqua)
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
    defer { surfaceView.closeSurface() }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    defer { window.contentView = nil }
    let wrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    wrapper.frame.size = CGSize(width: 800, height: 600)
    window.contentView?.addSubview(wrapper)
    window.contentView?.layoutSubtreeIfNeeded()
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
  func offWindowWrapperDoesNotDetachAttachedSurface() {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    defer { window.contentView = nil }

    let attachedWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    attachedWrapper.frame = window.contentView?.bounds ?? .zero
    window.contentView?.addSubview(attachedWrapper)
    window.contentView?.layoutSubtreeIfNeeded()
    #expect(surfaceView.window === window)

    let offWindowWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)

    #expect(offWindowWrapper.window == nil)
    #expect(surfaceView.window === window)
    #expect(surfaceView.scrollWrapper === attachedWrapper)
  }

  @Test
  @MainActor
  func attachingReplacementWrapperRefreshesSurfaceAppearance() throws {
    let runtime = try makeGhosttyRuntime(
      """
      background = #101010
      scrollbar = never
      """
    )
    let surfaceView = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in nil }
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    defer { window.contentView = nil }

    let attachedWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    window.contentView?.addSubview(attachedWrapper)
    let replacementWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    let replacementScrollView = try #require(
      replacementWrapper.subviews.compactMap { $0 as? NSScrollView }.first
    )

    try withConfigChangeAction(
      """
      background = #F4E6D8
      scrollbar = system
      """
    ) { action in
      #expect(surfaceView.bridge.handleAction(target: ghosttySurfaceTarget(), action: action))
    }

    #expect(!replacementScrollView.hasVerticalScroller)
    #expect(replacementScrollView.appearance?.name == .darkAqua)

    window.contentView?.addSubview(replacementWrapper)

    #expect(surfaceView.scrollWrapper === replacementWrapper)
    #expect(replacementScrollView.hasVerticalScroller)
    #expect(replacementScrollView.appearance?.name == .aqua)
  }

  @Test
  @MainActor
  func splitReparentResizesCoreSurface() throws {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }
    let surface = try #require(surfaceView.surface)

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    defer { window.contentView = nil }

    let fullWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    fullWrapper.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
    window.contentView?.addSubview(fullWrapper)
    fullWrapper.layoutSubtreeIfNeeded()
    let fullWidth = ghostty_surface_size(surface).width_px
    try #require(fullWidth > 0)

    let splitWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    fullWrapper.removeFromSuperview()
    splitWrapper.frame = NSRect(x: 0, y: 0, width: 600, height: 800)
    window.contentView?.addSubview(splitWrapper)
    splitWrapper.layoutSubtreeIfNeeded()

    #expect(ghostty_surface_size(surface).width_px < fullWidth)
  }

  @Test
  @MainActor
  func defunctWrapperLayoutLeavesReparentedSurfaceAlone() {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    defer { surfaceView.closeSurface() }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    defer { window.contentView = nil }

    let defunctWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    defunctWrapper.frame.size = CGSize(width: 1200, height: 800)
    window.contentView?.addSubview(defunctWrapper)
    window.contentView?.layoutSubtreeIfNeeded()

    let splitWrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)
    splitWrapper.frame.size = CGSize(width: 600, height: 800)
    defunctWrapper.removeFromSuperview()
    window.contentView?.addSubview(splitWrapper)
    window.contentView?.layoutSubtreeIfNeeded()
    #expect(surfaceView.frame.size == CGSize(width: 600, height: 800))

    defunctWrapper.needsLayout = true
    defunctWrapper.layoutSubtreeIfNeeded()

    #expect(surfaceView.frame.size == CGSize(width: 600, height: 800))
  }

  @Test
  @MainActor
  func deferredGeometryResizeInvalidatesWrapperLayout() {
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

    wrapper.needsLayout = false
    wrapper.invalidateLayout(ifSizeDiffersFrom: wrapper.bounds.size)
    #expect(!wrapper.needsLayout)

    wrapper.invalidateLayout(ifSizeDiffersFrom: CGSize(width: 900, height: 700))
    #expect(wrapper.needsLayout)
  }

  @Test
  func dragTypesExcludeGenericURLs() {
    #expect(GhosttySurfaceView.acceptsDropTypes([.fileURL]))
    #expect(GhosttySurfaceView.acceptsDropTypes([.string]))
    #expect(!GhosttySurfaceView.acceptsDropTypes([.URL]))
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
  @MainActor
  func selectionChangesNotifyCurrentAccessibilityTextAfterDebounce() async {
    initializeGhosttyForTests()

    let clock = TestClock()
    let selection = SelectionTextSource()
    var selectionReadCount = 0
    var notifiedSelections: [String?] = []
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      selectionReader: { _ in
        selectionReadCount += 1
        return selection.value
      },
      accessibilitySelectionNotifier: {
        notifiedSelections.append($0.accessibilitySelectedText())
      },
      accessibilitySelectionSleep: {
        try await clock.sleep(for: $0)
      }
    )
    defer { surfaceView.closeSurface() }

    selection.value = "first"
    #expect(surfaceView.bridge.handleAction(target: selectionTarget(), action: selectionChangedAction()))
    #expect(selectionReadCount == 0)
    await advanceClock(clock, by: .milliseconds(100))
    #expect(notifiedSelections == ["first"])

    selection.value = "second"
    #expect(surfaceView.accessibilitySelectedText() == "second")
    #expect(surfaceView.bridge.handleAction(target: selectionTarget(), action: selectionChangedAction()))
    await advanceClock(clock, by: .milliseconds(100))
    #expect(notifiedSelections == ["first", "second"])

    selection.value = nil
    #expect(surfaceView.bridge.handleAction(target: selectionTarget(), action: selectionChangedAction()))
    await advanceClock(clock, by: .milliseconds(100))
    #expect(notifiedSelections == ["first", "second", nil])
  }

  @Test
  @MainActor
  func rapidSelectionChangesProduceOneNotification() async {
    initializeGhosttyForTests()

    let clock = TestClock()
    var notificationCount = 0
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      accessibilitySelectionNotifier: { _ in notificationCount += 1 },
      accessibilitySelectionSleep: { try await clock.sleep(for: $0) }
    )
    defer { surfaceView.closeSurface() }

    for _ in 0..<6 {
      _ = surfaceView.bridge.handleAction(
        target: selectionTarget(),
        action: selectionChangedAction()
      )
      await advanceClock(clock, by: .milliseconds(75))
      #expect(notificationCount == 0)
    }

    _ = surfaceView.bridge.handleAction(
      target: selectionTarget(),
      action: selectionChangedAction()
    )
    await advanceClock(clock, by: .milliseconds(99))
    #expect(notificationCount == 0)
    await advanceClock(clock, by: .milliseconds(1))
    #expect(notificationCount == 1)
  }

  @Test
  @MainActor
  func closingSurfaceCancelsPendingSelectionNotification() async {
    initializeGhosttyForTests()

    let clock = TestClock()
    var notificationCount = 0
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      accessibilitySelectionNotifier: { _ in notificationCount += 1 },
      accessibilitySelectionSleep: { try await clock.sleep(for: $0) }
    )

    _ = surfaceView.bridge.handleAction(
      target: selectionTarget(),
      action: selectionChangedAction()
    )
    surfaceView.closeSurface()
    _ = surfaceView.bridge.handleAction(
      target: selectionTarget(),
      action: selectionChangedAction()
    )
    await advanceClock(clock, by: .milliseconds(100))

    #expect(notificationCount == 0)
    #expect(surfaceView.accessibilitySelectedText() == nil)
  }

  @Test
  @MainActor
  func selectionChangeWithoutAccessibilityObserverIsHarmless() async {
    initializeGhosttyForTests()

    let clock = TestClock()
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      selectionReader: { _ in "selected text" },
      accessibilitySelectionSleep: { try await clock.sleep(for: $0) }
    )
    defer { surfaceView.closeSurface() }

    _ = surfaceView.bridge.handleAction(
      target: selectionTarget(),
      action: selectionChangedAction()
    )
    await advanceClock(clock, by: .milliseconds(100))

    #expect(surfaceView.accessibilitySelectedText() == "selected text")
  }

  @Test
  @MainActor
  func copyAndServicesReadAccessibilitySelection() {
    initializeGhosttyForTests()

    let selection = SelectionTextSource()
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      selectionReader: { _ in selection.value }
    )
    defer { surfaceView.closeSurface() }
    let copyItem = NSMenuItem(
      title: "Copy",
      action: #selector(GhosttySurfaceView.copy(_:)),
      keyEquivalent: ""
    )

    #expect(!surfaceView.validateMenuItem(copyItem))
    selection.value = ""
    #expect(!surfaceView.validateMenuItem(copyItem))
    selection.value = "selected text"
    #expect(surfaceView.validateMenuItem(copyItem))
    #expect(surfaceView.accessibilitySelectedText() == "selected text")

    let pasteboard = NSPasteboard(name: NSPasteboard.Name(UUID().uuidString))
    #expect(surfaceView.writeSelection(to: pasteboard, types: [.string]))
    #expect(pasteboard.string(forType: .string) == "selected text")
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

    let host = TerminalHostState.test(
      runtime: GhosttyRuntime(),
      createsLiveTerminalSurfaces: true,
      zmxClient: .noop,
      zmxSessionsEnabled: false
    )
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
  func searchFieldReturnCommitsMarkedTextBeforeNavigating() throws {
    try withSearchField { field, editor, recorder, window in
      editor.setMarkedText(
        "かな",
        selectedRange: NSRange(location: 2, length: 0),
        replacementRange: NSRange(location: NSNotFound, length: 0)
      )
      #expect(editor.hasMarkedText())

      window.sendEvent(
        try makeKeyEvent(
          keyCode: kVK_Return,
          characters: "\r",
          modifierFlags: [],
          windowNumber: window.windowNumber
        )
      )

      #expect(!editor.hasMarkedText())
      #expect(field.stringValue == "かな")
      #expect(recorder.submissions.isEmpty)

      window.sendEvent(
        try makeKeyEvent(
          keyCode: kVK_Return,
          characters: "\r",
          modifierFlags: [],
          windowNumber: window.windowNumber
        )
      )

      #expect(recorder.submissions == [false])
    }
  }

  @Test
  @MainActor
  func searchFieldShiftReturnNavigatesBackward() throws {
    try withSearchField(modifierFlags: .shift) { _, _, recorder, window in
      window.sendEvent(
        try makeKeyEvent(
          keyCode: kVK_Return,
          characters: "\r",
          modifierFlags: .shift,
          windowNumber: window.windowNumber
        )
      )

      #expect(recorder.submissions == [true])
    }
  }

  @Test
  @MainActor
  func searchFieldShiftReturnUsesProductionWiring() async throws {
    let recorder = SearchFieldCommandRecorder()
    let representable = GhosttySearchField(
      text: Binding(
        get: { recorder.text },
        set: { recorder.text = $0 }
      ),
      focusRequest: 0,
      selectionRequest: 0,
      onSubmit: {
        recorder.submissions.append($0)
        NSApp.stopModal()
      },
      onEscape: { recorder.escapeCount += 1 }
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 300, height: 100),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let hostingView = NSHostingView(rootView: representable)
    window.contentView = hostingView
    window.makeKeyAndOrderFront(nil)
    defer {
      window.contentView = nil
      window.orderOut(nil)
    }

    let field = try await searchField(in: hostingView)
    try #require(window.makeFirstResponder(field))
    NSApp.postEvent(
      try makeKeyEvent(
        keyCode: kVK_Return,
        characters: "\r",
        modifierFlags: .shift,
        windowNumber: window.windowNumber
      ),
      atStart: true
    )
    NSApp.runModal(for: window)

    #expect(recorder.submissions == [true])
  }

  @Test
  @MainActor
  func searchFieldEscapeClosesSearch() throws {
    try withSearchField { _, _, recorder, window in
      window.sendEvent(
        try makeKeyEvent(
          keyCode: kVK_Escape,
          characters: "\u{1b}",
          modifierFlags: [],
          windowNumber: window.windowNumber
        )
      )

      #expect(recorder.escapeCount == 1)
    }
  }

  @Test
  @MainActor
  func searchOverlayUpdateDoesNotStealFocusAfterSplit() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test(runtime: GhosttyRuntime())
    host.ensureInitialTab(focusing: false, startupCommand: nil)
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
  func shortSearchNeedleWritesFindPasteboardBeforeDebouncedSearch() async throws {
    initializeGhosttyForTests()

    let pasteboard = makeFindPasteboard("")
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      findPasteboard: pasteboard
    )
    surface.bridge.state.searchNeedle = ""
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    let overlay = NSHostingView(rootView: GhosttySurfaceSearchOverlay(surfaceView: surface))
    surface.frame = container.bounds
    overlay.frame = container.bounds
    window.contentView = container
    container.addSubview(surface)
    container.addSubview(overlay)
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    let searchField = try await searchField(in: container)
    searchField.stringValue = "ab"
    searchField.delegate?.controlTextDidChange?(
      Notification(name: NSControl.textDidChangeNotification, object: searchField)
    )
    for _ in 0..<20 where pasteboard.string(forType: .string) != "ab" {
      await Task.yield()
    }

    #expect(surface.bridge.state.searchNeedle == "ab")
    #expect(pasteboard.string(forType: .string) == "ab")

    replaceFindPasteboard(pasteboard, with: "other-app")
    try await Task.sleep(for: .milliseconds(350))

    #expect(pasteboard.string(forType: .string) == "other-app")
  }

  @Test
  @MainActor
  func activationRestoresNeedleBeforeSearchOverlayAppears() async throws {
    initializeGhosttyForTests()

    let pasteboard = makeFindPasteboard("before")
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      findPasteboard: pasteboard
    )
    surface.bridge.state.searchNeedle = "before"
    replaceFindPasteboard(pasteboard, with: "after")
    NotificationCenter.default.post(
      name: NSApplication.didBecomeActiveNotification,
      object: NSApplication.shared
    )
    #expect(surface.bridge.state.searchNeedle == "after")
    #expect(surface.bridge.state.searchSelectionRequestCount == 1)

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    let overlay = NSHostingView(rootView: GhosttySurfaceSearchOverlay(surfaceView: surface))
    surface.frame = container.bounds
    overlay.frame = container.bounds
    window.contentView = container
    container.addSubview(surface)
    container.addSubview(overlay)
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    let searchField = try await searchField(in: container)
    #expect(await searchFieldHasValue(searchField, value: "after"))
    #expect(surface.bridge.state.searchNeedle == "after")
    #expect(surface.bridge.state.searchSelectionRequestCount == 1)
  }

  @Test
  @MainActor
  func appearingSearchOverlayKeepsItsNeedleWithoutActivation() async throws {
    initializeGhosttyForTests()

    let pasteboard = makeFindPasteboard("other-tab")
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      findPasteboard: pasteboard
    )
    surface.bridge.state.searchNeedle = "this-tab"
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    let overlay = NSHostingView(rootView: GhosttySurfaceSearchOverlay(surfaceView: surface))
    surface.frame = container.bounds
    overlay.frame = container.bounds
    window.contentView = container
    container.addSubview(surface)
    container.addSubview(overlay)
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    let searchField = try await searchField(in: container)
    #expect(await searchFieldHasValue(searchField, value: "this-tab"))
    #expect(surface.bridge.state.searchNeedle == "this-tab")
  }

  @Test
  @MainActor
  func restoredFindNeedleIsSelectedAndKeepsSearchFocusOnActivation() async throws {
    initializeGhosttyForTests()

    let pasteboard = makeFindPasteboard("restored")
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      findPasteboard: pasteboard
    )
    withStartSearchAction(needle: "") { action in
      _ = surface.bridge.handleAction(target: ghosttySurfaceTarget(), action: action)
    }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    let overlay = NSHostingView(rootView: GhosttySurfaceSearchOverlay(surfaceView: surface))
    surface.frame = container.bounds
    overlay.frame = container.bounds
    window.contentView = container
    container.addSubview(surface)
    container.addSubview(overlay)
    window.makeKeyAndOrderFront(nil)
    defer {
      surface.closeSurface()
      window.contentView = nil
      window.orderOut(nil)
    }

    let searchField = try await searchField(in: container)
    #expect(await searchFieldHasSelectedValue(searchField, value: "restored"))
    #expect(
      window.firstResponder === searchField || window.firstResponder === searchField.currentEditor()
    )

    replaceFindPasteboard(pasteboard, with: "activated")
    NotificationCenter.default.post(
      name: NSApplication.didBecomeActiveNotification,
      object: NSApplication.shared
    )

    #expect(await searchFieldHasSelectedValue(searchField, value: "activated"))
    #expect(surface.bridge.state.searchNeedle == "activated")
    #expect(
      window.firstResponder === searchField || window.firstResponder === searchField.currentEditor()
    )
  }

  @Test
  @MainActor
  func firstSearchSelectsRestoredNeedleAfterIntermediateRender() async throws {
    initializeGhosttyForTests()

    let pasteboard = makeFindPasteboard("restored")
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      findPasteboard: pasteboard
    )
    withStartSearchAction(needle: "") { action in
      _ = surface.bridge.handleAction(target: ghosttySurfaceTarget(), action: action)
    }
    let window = SearchSelectionWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    surface.frame = container.bounds
    window.contentView = container
    container.addSubview(surface)
    window.makeKeyAndOrderFront(nil)
    _ = window.makeFirstResponder(surface)
    defer {
      surface.closeSurface()
      window.contentView = nil
      window.orderOut(nil)
    }
    try #require(window.firstResponder === surface)

    let focusDeferral = SearchFocusDeferral()
    let overlay = NSHostingView(
      rootView: GhosttySurfaceSearchOverlay(
        surfaceView: surface,
        deferFocusRequest: {
          await focusDeferral.wait()
        }
      )
    )
    overlay.frame = container.bounds
    container.addSubview(overlay)
    let searchField = try await searchField(in: container)
    for _ in 0..<20 where !focusDeferral.isWaiting {
      await Task.yield()
    }
    try #require(focusDeferral.isWaiting)
    surface.bridge.state.searchTotal = 1
    try await Task.sleep(for: .milliseconds(50))
    container.layoutSubtreeIfNeeded()

    #expect(searchField.currentEditor() == nil)
    focusDeferral.resume()
    #expect(await searchFieldHasSelectedValue(searchField, value: "restored"))
  }

  @Test
  @MainActor
  func restoredFindNeedleWithoutEditorDoesNotStealFocusOrSelectLater() async throws {
    initializeGhosttyForTests()

    let pasteboard = makeFindPasteboard("before")
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      findPasteboard: pasteboard
    )
    surface.bridge.state.searchNeedle = "before"
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    let overlay = NSHostingView(rootView: GhosttySurfaceSearchOverlay(surfaceView: surface))
    surface.frame = container.bounds
    overlay.frame = container.bounds
    window.contentView = container
    container.addSubview(surface)
    container.addSubview(overlay)
    window.makeFirstResponder(surface)
    defer {
      surface.closeSurface()
      window.contentView = nil
    }
    let searchField = try await searchField(in: container)

    replaceFindPasteboard(pasteboard, with: "after")
    NotificationCenter.default.post(
      name: NSApplication.didBecomeActiveNotification,
      object: NSApplication.shared
    )
    for _ in 0..<20 where surface.bridge.state.searchNeedle != "after" {
      await Task.yield()
    }

    #expect(surface.bridge.state.searchNeedle == "after")
    #expect(window.firstResponder === surface)

    #expect(await searchFieldHasValue(searchField, value: "after"))
    #expect(searchField.currentEditor() == nil)
    window.makeFirstResponder(searchField)
    let editor = try #require(searchField.currentEditor())
    let caret = NSRange(location: searchField.stringValue.utf16.count, length: 0)
    editor.selectedRange = caret
    surface.bridge.state.searchTotal = 1
    await Task.yield()
    await Task.yield()

    #expect(editor.selectedRange == caret)
  }

  @Test
  @MainActor
  func surfaceActivityRequiresSurfaceFirstResponder() throws {
    initializeGhosttyForTests()

    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 120, height: 24))
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    surface.frame = container.bounds
    container.addSubview(surface)
    container.addSubview(textField)
    window.contentView = container
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    window.makeFirstResponder(surface)
    try #require(window.firstResponder === surface)
    #expect(
      TerminalHostState.surfaceActivity(
        isSelectedTab: true,
        windowIsVisible: true,
        windowIsKey: true,
        focusedSurfaceID: surface.id,
        surface: surface
      ).isFocused
    )

    window.makeFirstResponder(textField)
    #expect(
      !TerminalHostState.surfaceActivity(
        isSelectedTab: true,
        windowIsVisible: true,
        windowIsKey: true,
        focusedSurfaceID: surface.id,
        surface: surface
      ).isFocused
    )
  }

  @Test
  @MainActor
  func endSearchActionRestoresSurfaceFocusAndClearsState() throws {
    initializeGhosttyForTests()

    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 120, height: 24))
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    surface.frame = container.bounds
    container.addSubview(surface)
    container.addSubview(textField)
    window.contentView = container
    defer {
      surface.closeSurface()
      window.contentView = nil
    }
    surface.bridge.state.searchNeedle = "needle"
    surface.bridge.state.searchTotal = 2
    surface.bridge.state.searchSelected = 1
    window.makeFirstResponder(textField)
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    let action = ghostty_action_s(tag: GHOSTTY_ACTION_END_SEARCH, action: ghostty_action_u())

    #expect(surface.bridge.handleAction(target: target, action: action))

    #expect(window.firstResponder === surface)
    #expect(surface.bridge.state.searchNeedle == nil)
    #expect(surface.bridge.state.searchTotal == nil)
    #expect(surface.bridge.state.searchSelected == nil)
  }

  @Test
  @MainActor
  func syncFocusRestoresSurfaceFirstResponderFromPassiveWindowView() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
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

    let host = TerminalHostState.test(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
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

    let host = TerminalHostState.test(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
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

    let host = TerminalHostState.test(runtime: GhosttyRuntime(), zmxClient: .noop, zmxSessionsEnabled: false)
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

private func selectionTarget() -> ghostty_target_s {
  ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
}

private func selectionChangedAction() -> ghostty_action_s {
  ghostty_action_s(tag: GHOSTTY_ACTION_SELECTION_CHANGED, action: ghostty_action_u())
}

@MainActor
private final class SelectionTextSource {
  var value: String?
}

private final class FocusableWrapperView: NSView {
  override var acceptsFirstResponder: Bool { true }
}

@MainActor
private final class SearchFieldCommandRecorder {
  var escapeCount = 0
  var submissions: [Bool] = []
  var text = ""
}

@MainActor
private func withSearchField(
  modifierFlags: NSEvent.ModifierFlags = [],
  perform body: (
    _ field: NSTextField,
    _ editor: NSTextView,
    _ recorder: SearchFieldCommandRecorder,
    _ window: NSWindow
  ) throws -> Void
) throws {
  let recorder = SearchFieldCommandRecorder()
  let coordinator = GhosttySearchFieldDelegate(
    text: Binding(
      get: { recorder.text },
      set: { recorder.text = $0 }
    ),
    onSubmit: { recorder.submissions.append($0) },
    onEscape: { recorder.escapeCount += 1 },
    modifierFlags: { modifierFlags }
  )
  let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 200, height: 24))
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 300, height: 100),
    styleMask: [.titled],
    backing: .buffered,
    defer: false
  )
  field.delegate = coordinator
  window.contentView = field
  try #require(window.makeFirstResponder(field))
  let editor = try #require(field.currentEditor() as? NSTextView)
  defer {
    window.contentView = nil
    window.orderOut(nil)
  }

  try body(field, editor, recorder, window)
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
private final class SearchFocusDeferral {
  private var continuation: CheckedContinuation<Void, Never>?

  var isWaiting: Bool {
    continuation != nil
  }

  func wait() async {
    await withCheckedContinuation { continuation in
      self.continuation = continuation
    }
  }

  func resume() {
    continuation?.resume()
    continuation = nil
  }
}

@MainActor
private final class SearchSelectionWindow: NSWindow {
  override func makeFirstResponder(_ responder: NSResponder?) -> Bool {
    let didChange = super.makeFirstResponder(responder)
    if didChange, let field = responder as? NSTextField {
      field.currentEditor()?.selectedRange = NSRange(location: field.stringValue.utf16.count, length: 0)
    }
    return didChange
  }
}

@MainActor
private func searchFieldHasSelectedValue(_ field: NSTextField, value: String) async -> Bool {
  for _ in 0..<20 {
    if field.stringValue == value,
      field.currentEditor()?.selectedRange == NSRange(location: 0, length: value.utf16.count)
    {
      return true
    }
    await Task.yield()
  }
  return false
}

@MainActor
private func searchFieldHasValue(_ field: NSTextField, value: String) async -> Bool {
  for _ in 0..<20 {
    if field.stringValue == value {
      return true
    }
    await Task.yield()
  }
  return false
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
