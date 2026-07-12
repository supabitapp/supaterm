import AppKit
import Carbon.HIToolbox
import GhosttyKit
import Testing

@testable import supaterm

@Suite(.serialized)
@MainActor
struct GhosttyClipboardConfirmationTests {
  @Test
  func unsafeSelectionPasteShowsConfirmationOnOriginatingWindow() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }

    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("printf first\nprintf second", forType: .string)

    fixture.surface.pasteSelection(nil)

    let sheet = try await attachedSheet(of: fixture.window)
    #expect(sheet.sheetParent === fixture.window)
    #expect(buttonTitles(in: sheet).isSuperset(of: ["Cancel", "Paste"]))
  }

  @Test
  func unfocusedSplitClipboardRequestIsDeniedBeforeFocusedRequest() async throws {
    let fixture = try SplitClipboardSurfaceFixture()
    defer { fixture.close() }
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("UNFOCUSED_A\nUNFOCUSED_B", forType: .string)

    fixture.unfocusedSurface.pasteSelection(nil)

    let unfocusedSheet = try await presentedSheet(of: fixture.window, timeout: .milliseconds(100))
    #expect(unfocusedSheet == nil)
    if let unfocusedSheet {
      try button(titled: "Cancel", in: unfocusedSheet).performClick(nil)
      try await waitForSheetDismissal(from: fixture.window)
    }

    pasteboard.clearContents()
    pasteboard.setString("FOCUSED_A\nFOCUSED_B", forType: .string)
    fixture.focusedSurface.pasteSelection(nil)

    let focusedSheet = try await attachedSheet(of: fixture.window)
    #expect(textPreview(in: focusedSheet).contains("FOCUSED_B"))
    try button(titled: "Cancel", in: focusedSheet).performClick(nil)
    try await waitForSheetDismissal(from: fixture.window)
  }

  @Test
  func confirmationPreviewPreservesLongSelectableMonospacedTextInVerticalScroller() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    let contents = (0..<300).map { "line-\($0)" }.joined(separator: "\n")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString(contents, forType: .string)

    fixture.surface.pasteSelection(nil)

    let sheet = try await attachedSheet(of: fixture.window)
    let scrollView = try #require(textPreviewScrollView(in: sheet))
    let textView = try #require(scrollView.documentView as? NSTextView)
    #expect(scrollView.hasVerticalScroller)
    #expect(textView.isSelectable)
    #expect(!textView.isEditable)
    #expect(textView.font?.fontDescriptor.symbolicTraits.contains(.monoSpace) == true)
    #expect(textView.string == contents)
  }

  @Test
  func cancellingUnsafePasteLeavesTerminalInputUnchanged() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let marker = "SUPATERM_UNSAFE_\(UUID().uuidString)"
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("\(marker)_A\n\(marker)_B", forType: .string)

    fixture.surface.pasteSelection(nil)

    let sheet = try await attachedSheet(of: fixture.window)
    try button(titled: "Cancel", in: sheet).performClick(nil)
    try await waitForSheetDismissal(from: fixture.window)
    pasteboard.clearContents()
    pasteboard.setString("SUPATERM_SAFE_PROBE", forType: .string)
    fixture.surface.pasteSelection(nil)
    fixture.surface.bridge.sendKey(.enter)
    let contents = try await capturedText(
      from: fixture.surface,
      containing: "SUPATERM_SAFE_PROBE"
    )
    #expect(!contents.contains(marker))
  }

  @Test
  func allowingUnsafePasteSendsOriginalTextOnce() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let marker = "SUPATERM_ALLOWED_\(UUID().uuidString)"
    let firstLine = "\(marker)_A"
    let secondLine = "\(marker)_B"
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("\(firstLine)\n\(secondLine)\n", forType: .string)

    fixture.surface.pasteSelection(nil)

    let sheet = try await attachedSheet(of: fixture.window)
    try button(titled: "Paste", in: sheet).performClick(nil)
    try await waitForSheetDismissal(from: fixture.window)
    let contents = try await capturedText(from: fixture.surface, containing: secondLine)
    #expect(occurrences(of: firstLine, in: contents) == 1)
    #expect(occurrences(of: secondLine, in: contents) == 1)
  }

  @Test
  func unsafePasteWithoutWindowIsDeniedAndUnblocksLaterPaste() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let marker = "SUPATERM_DETACHED_\(UUID().uuidString)"
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("\(marker)_A\n\(marker)_B", forType: .string)
    fixture.window.contentView = nil

    fixture.surface.pasteSelection(nil)

    #expect(fixture.window.attachedSheet == nil)
    fixture.window.contentView = fixture.surface
    pasteboard.clearContents()
    pasteboard.setString("SUPATERM_AFTER_DENIAL", forType: .string)
    fixture.surface.pasteSelection(nil)
    fixture.surface.bridge.sendKey(.enter)
    let contents = try await capturedText(
      from: fixture.surface,
      containing: "SUPATERM_AFTER_DENIAL"
    )
    #expect(!contents.contains(marker))
  }

  @Test
  func secondClipboardRequestDoesNotReplaceActiveSheet() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let firstMarker = "SUPATERM_FIRST_\(UUID().uuidString)"
    let secondMarker = "SUPATERM_SECOND_\(UUID().uuidString)"
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("\(firstMarker)_A\n\(firstMarker)_B", forType: .string)
    fixture.surface.pasteSelection(nil)
    let firstSheet = try await attachedSheet(of: fixture.window)

    pasteboard.clearContents()
    pasteboard.setString("\(secondMarker)_A\n\(secondMarker)_B", forType: .string)
    fixture.surface.pasteSelection(nil)

    #expect(fixture.window.attachedSheet === firstSheet)
    #expect(textPreview(in: firstSheet).contains(firstMarker))
    #expect(!textPreview(in: firstSheet).contains(secondMarker))
    try button(titled: "Cancel", in: firstSheet).performClick(nil)
    try await waitForSheetDismissal(from: fixture.window)
    pasteboard.clearContents()
    pasteboard.setString("SUPATERM_AFTER_CONCURRENT", forType: .string)
    fixture.surface.pasteSelection(nil)
    fixture.surface.bridge.sendKey(.enter)
    let contents = try await capturedText(
      from: fixture.surface,
      containing: "SUPATERM_AFTER_CONCURRENT"
    )
    #expect(!contents.contains(firstMarker))
    #expect(!contents.contains(secondMarker))
  }

  @Test
  func closingOriginatingSurfaceCancelsClipboardRequest() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("unsafe first\nunsafe second", forType: .string)
    fixture.surface.pasteSelection(nil)
    _ = try await attachedSheet(of: fixture.window)

    fixture.surface.closeSurface()

    try await waitForSheetDismissal(from: fixture.window)
    #expect(fixture.surface.surface == nil)
  }

  @Test
  func detachingSurfaceDeniesPendingPasteAndAllowsRequestAfterReattachment() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let deniedMarker = "SUPATERM_DENIED_\(UUID().uuidString)"
    let allowedMarker = "SUPATERM_REATTACHED_\(UUID().uuidString)"
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("\(deniedMarker)_A\n\(deniedMarker)_B", forType: .string)
    fixture.surface.pasteSelection(nil)
    let dismissedSheet = try await attachedSheet(of: fixture.window)

    fixture.window.contentView = nil

    try await waitForSheetDismissal(from: fixture.window)
    #expect(fixture.surface.window == nil)
    fixture.window.contentView = fixture.surface
    #expect(fixture.window.makeFirstResponder(fixture.surface))
    pasteboard.clearContents()
    pasteboard.setString("\(allowedMarker)_A\n\(allowedMarker)_B\n", forType: .string)
    fixture.surface.pasteSelection(nil)
    let reattachedSheet = try await attachedSheet(of: fixture.window)
    #expect(reattachedSheet !== dismissedSheet)
    try button(titled: "Paste", in: reattachedSheet).performClick(nil)
    let contents = try await capturedText(
      from: fixture.surface,
      containing: "\(allowedMarker)_B"
    )
    #expect(!contents.contains(deniedMarker))
  }

  @Test
  func escapeDeniesUnsafePaste() async throws {
    let fixture = try ClipboardSurfaceFixture()
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let marker = "SUPATERM_ESCAPE_\(UUID().uuidString)"
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("\(marker)_A\n\(marker)_B", forType: .string)
    fixture.surface.pasteSelection(nil)
    let sheet = try await attachedSheet(of: fixture.window)
    let event = try #require(
      NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: sheet.windowNumber,
        context: nil,
        characters: "\u{1b}",
        charactersIgnoringModifiers: "\u{1b}",
        isARepeat: false,
        keyCode: UInt16(kVK_Escape)
      )
    )

    #expect(sheet.performKeyEquivalent(with: event))
    try await waitForSheetDismissal(from: fixture.window)
    pasteboard.clearContents()
    pasteboard.setString("SUPATERM_AFTER_ESCAPE", forType: .string)
    fixture.surface.pasteSelection(nil)
    fixture.surface.bridge.sendKey(.enter)
    let contents = try await capturedText(
      from: fixture.surface,
      containing: "SUPATERM_AFTER_ESCAPE"
    )
    #expect(!contents.contains(marker))
  }

  @Test
  func denyingOSC52WritePreservesSelectionClipboard() async throws {
    let script = try TemporaryExecutableScript.osc52Write()
    defer { script.remove() }
    let fixture = try ClipboardSurfaceFixture(
      config: "clipboard-write = ask",
      command: script.path
    )
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("sentinel", forType: .string)

    fixture.surface.bridge.sendKey(.enter)

    let sheet = try await attachedSheet(of: fixture.window)
    #expect(buttonTitles(in: sheet).isSuperset(of: ["Deny", "Allow"]))
    #expect(textPreview(in: sheet).contains("secret"))
    try button(titled: "Deny", in: sheet).performClick(nil)
    try await waitForSheetDismissal(from: fixture.window)
    #expect(pasteboard.string(forType: .string) == "sentinel")
  }

  @Test
  func allowingOSC52WriteUpdatesSelectionClipboard() async throws {
    let script = try TemporaryExecutableScript.osc52Write()
    defer { script.remove() }
    let fixture = try ClipboardSurfaceFixture(
      config: "clipboard-write = ask",
      command: script.path
    )
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("sentinel", forType: .string)

    fixture.surface.bridge.sendKey(.enter)

    let sheet = try await attachedSheet(of: fixture.window)
    try button(titled: "Allow", in: sheet).performClick(nil)
    try await waitForSheetDismissal(from: fixture.window)
    #expect(pasteboard.string(forType: .string) == "secret")
  }

  @Test
  func closingWindowDeniesPendingOSC52Write() async throws {
    let script = try TemporaryExecutableScript.osc52Write()
    defer { script.remove() }
    let fixture = try ClipboardSurfaceFixture(
      config: "clipboard-write = ask",
      command: script.path
    )
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("sentinel", forType: .string)
    fixture.surface.bridge.sendKey(.enter)
    let sheet = try await attachedSheet(of: fixture.window)

    NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: fixture.window)

    fixture.window.endSheet(sheet)
    try await waitForSheetDismissal(from: fixture.window)
    #expect(pasteboard.string(forType: .string) == "sentinel")
  }

  @Test
  func denyingOSC52ReadReturnsEmptyClipboardResponse() async throws {
    let script = try TemporaryExecutableScript.osc52Read()
    defer { script.remove() }
    let fixture = try ClipboardSurfaceFixture(
      config: "clipboard-read = ask",
      command: script.path
    )
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("secret", forType: .string)
    fixture.surface.bridge.sendKey(.enter)

    let sheet = try await attachedSheet(of: fixture.window)
    #expect(buttonTitles(in: sheet).isSuperset(of: ["Deny", "Allow"]))
    #expect(textPreview(in: sheet).contains("secret"))
    try button(titled: "Deny", in: sheet).performClick(nil)
    _ = try await capturedText(
      from: fixture.surface,
      containing: "SUPATERM_RESPONSE_1b5d35323b733b1b5c"
    )
  }

  @Test
  func allowingOSC52ReadReturnsClipboardContents() async throws {
    let script = try TemporaryExecutableScript.osc52Read()
    defer { script.remove() }
    let fixture = try ClipboardSurfaceFixture(
      config: "clipboard-read = ask",
      command: script.path
    )
    defer { fixture.close() }
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("secret", forType: .string)
    fixture.surface.bridge.sendKey(.enter)

    let sheet = try await attachedSheet(of: fixture.window)
    try button(titled: "Allow", in: sheet).performClick(nil)
    _ = try await capturedText(
      from: fixture.surface,
      containing: "SUPATERM_RESPONSE_1b5d35323b733b6332566a636d56301b5c"
    )
  }

  @Test
  func closingWindowCompletesPendingOSC52ReadOnceWithEmptyResponse() async throws {
    let script = try TemporaryExecutableScript.countingOSC52Read()
    defer { script.remove() }
    let fixture = try ClipboardSurfaceFixture(
      config: "clipboard-read = ask",
      command: script.path
    )
    defer { fixture.close() }
    fixture.window.isReleasedWhenClosed = false
    _ = try await capturedText(from: fixture.surface, containing: "SUPATERM_READY")
    let pasteboard = NSPasteboard.ghosttySelection
    pasteboard.clearContents()
    pasteboard.setString("secret", forType: .string)
    fixture.surface.bridge.sendKey(.enter)
    _ = try await attachedSheet(of: fixture.window)

    fixture.window.close()

    let expectedResponse = "SUPATERM_RESPONSE_COUNT_1_1b5d35323b733b1b5c"
    let contents = try await capturedText(
      from: fixture.surface,
      containing: expectedResponse
    )
    #expect(occurrences(of: "SUPATERM_RESPONSE_COUNT_", in: contents) == 1)
  }
}

private struct TemporaryExecutableScript {
  let url: URL

  var path: String { url.path }

  init(_ contents: String) throws {
    url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("sh")
    try contents.write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path)
  }

  static func osc52Write() throws -> Self {
    try Self(
      #"""
      #!/bin/sh
      printf SUPATERM_READY
      IFS= read -r trigger
      printf '\033]52;s;c2VjcmV0\a'
      cat
      """#
    )
  }

  static func osc52Read() throws -> Self {
    try Self(
      #"""
      #!/bin/bash
      printf SUPATERM_READY
      IFS= read -r trigger
      terminal_state=$(stty -g)
      stty raw -echo
      printf '\033]52;s;?\a'
      response=
      until [[ "$response" == *$'\033\\' ]]; do
        IFS= read -r -n 1 character
        response+="$character"
      done
      stty "$terminal_state"
      printf SUPATERM_RESPONSE_
      printf %s "$response" | od -An -tx1 | tr -d ' \n'
      printf '\n'
      cat
      """#
    )
  }

  static func countingOSC52Read() throws -> Self {
    try Self(
      #"""
      #!/bin/bash
      printf SUPATERM_READY
      IFS= read -r trigger
      terminal_state=$(stty -g)
      stty raw -echo
      printf '\033]52;s;?\a'
      response=
      until [[ "$response" == *$'\033\\' ]]; do
        IFS= read -r -n 1 character
        response+="$character"
      done
      response_count=1
      if IFS= read -r -n 1 -t 1 character; then
        extra_response="$character"
        until [[ "$extra_response" == *$'\033\\' ]]; do
          IFS= read -r -n 1 character
          extra_response+="$character"
        done
        response_count=2
      fi
      stty "$terminal_state"
      printf SUPATERM_RESPONSE_COUNT_%s_ "$response_count"
      printf %s "$response" | od -An -tx1 | tr -d ' \n'
      printf '\n'
      cat
      """#
    )
  }

  func remove() {
    try? FileManager.default.removeItem(at: url)
  }
}

@MainActor
private final class ClipboardSurfaceFixture {
  let runtime: GhosttyRuntime
  let surface: GhosttySurfaceView
  let window: NSWindow

  init(
    config: String = "clipboard-paste-protection = true",
    command: String = "/bin/sh -c 'printf SUPATERM_READY; stty -echo; cat'"
  ) throws {
    initializeGhosttyForTests()
    _ = NSApplication.shared
    runtime = try makeGhosttyRuntime(
      config,
      applicationIsActive: { false },
      pasteboardProvider: { _ in NSPasteboard.ghosttySelection }
    )
    surface = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      command: command,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 600, height: 400),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    window.contentView = surface
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(surface)
  }

  func close() {
    if let sheet = window.attachedSheet {
      window.endSheet(sheet)
    }
    surface.closeSurface()
    window.contentView = nil
    window.orderOut(nil)
    NSPasteboard.ghosttySelection.clearContents()
  }
}

@MainActor
private final class SplitClipboardSurfaceFixture {
  let runtime: GhosttyRuntime
  let focusedSurface: GhosttySurfaceView
  let unfocusedSurface: GhosttySurfaceView
  let window: NSWindow

  init() throws {
    initializeGhosttyForTests()
    runtime = try makeGhosttyRuntime(
      "clipboard-paste-protection = true",
      applicationIsActive: { false },
      pasteboardProvider: { _ in NSPasteboard.ghosttySelection }
    )
    let tabID = UUID()
    focusedSurface = GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID,
      workingDirectory: nil,
      command: "/bin/sh -c 'stty -echo; cat'",
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    unfocusedSurface = GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID,
      workingDirectory: nil,
      command: "/bin/sh -c 'stty -echo; cat'",
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 600, height: 400),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    let container = NSView(frame: window.contentView?.bounds ?? .zero)
    focusedSurface.frame = NSRect(x: 0, y: 0, width: 300, height: 400)
    unfocusedSurface.frame = NSRect(x: 300, y: 0, width: 300, height: 400)
    window.contentView = container
    container.addSubview(focusedSurface)
    container.addSubview(unfocusedSurface)
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(focusedSurface)
  }

  func close() {
    if let sheet = window.attachedSheet {
      window.endSheet(sheet)
    }
    focusedSurface.closeSurface()
    unfocusedSurface.closeSurface()
    window.contentView = nil
    window.orderOut(nil)
    NSPasteboard.ghosttySelection.clearContents()
  }
}

@MainActor
private func attachedSheet(of window: NSWindow) async throws -> NSWindow {
  for _ in 0..<50 {
    if let sheet = window.attachedSheet {
      return sheet
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  return try #require(window.attachedSheet)
}

@MainActor
private func presentedSheet(of window: NSWindow, timeout: Duration) async throws -> NSWindow? {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: timeout)
  while clock.now < deadline {
    if let sheet = window.attachedSheet {
      return sheet
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  return window.attachedSheet
}

@MainActor
private func waitForSheetDismissal(from window: NSWindow) async throws {
  for _ in 0..<100 {
    if window.attachedSheet == nil {
      return
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(window.attachedSheet == nil)
}

@MainActor
private func buttonTitles(in window: NSWindow) -> Set<String> {
  guard let contentView = window.contentView else { return [] }
  return Set(buttons(in: contentView).map(\.title))
}

@MainActor
private func button(titled title: String, in window: NSWindow) throws -> NSButton {
  let contentView = try #require(window.contentView)
  return try #require(buttons(in: contentView).first { $0.title == title })
}

@MainActor
private func textPreview(in window: NSWindow) -> String {
  guard let contentView = window.contentView else { return "" }
  let fieldText = textFields(in: contentView).map(\.stringValue)
  let viewText = textViews(in: contentView).map(\.string)
  return (fieldText + viewText).joined(separator: "\n")
}

@MainActor
private func textPreviewScrollView(in window: NSWindow) -> NSScrollView? {
  guard let contentView = window.contentView else { return nil }
  return scrollViews(in: contentView).first { $0.documentView is NSTextView }
}

@MainActor
private func capturedText(
  from surface: GhosttySurfaceView,
  containing marker: String
) async throws -> String {
  for _ in 0..<500 {
    let contents = surface.captureText(scope: .scrollback, lines: nil) ?? ""
    if contents.contains(marker) {
      return contents
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  let contents = surface.captureText(scope: .scrollback, lines: nil) ?? ""
  #expect(contents.contains(marker))
  return contents
}

private func occurrences(of needle: String, in value: String) -> Int {
  value.components(separatedBy: needle).count - 1
}

@MainActor
private func buttons(in view: NSView) -> [NSButton] {
  let nested = view.subviews.flatMap(buttons(in:))
  if let button = view as? NSButton {
    return [button] + nested
  }
  return nested
}

@MainActor
private func textFields(in view: NSView) -> [NSTextField] {
  let nested = view.subviews.flatMap(textFields(in:))
  if let textField = view as? NSTextField {
    return [textField] + nested
  }
  return nested
}

@MainActor
private func textViews(in view: NSView) -> [NSTextView] {
  let nested = view.subviews.flatMap(textViews(in:))
  if let textView = view as? NSTextView {
    return [textView] + nested
  }
  return nested
}

@MainActor
private func scrollViews(in view: NSView) -> [NSScrollView] {
  let nested = view.subviews.flatMap(scrollViews(in:))
  if let scrollView = view as? NSScrollView {
    return [scrollView] + nested
  }
  return nested
}
