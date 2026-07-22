import AppKit
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

private final class FocusableWrapperView: NSView {
  override var acceptsFirstResponder: Bool { true }
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
