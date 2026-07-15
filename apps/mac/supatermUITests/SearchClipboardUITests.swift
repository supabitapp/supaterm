import AppKit
import XCTest

final class SearchClipboardUITests: SupatermUITestCase {
  private enum AccessibilityIdentifier {
    static let searchField = "terminal.search.field"
    static let searchMatchCount = "terminal.search.match-count"
    static let clipboardConfirm = "terminal.clipboard-confirmation.confirm"
    static let clipboardCancel = "terminal.clipboard-confirmation.cancel"
  }

  private struct MatchCount: Equatable {
    let current: Int?
    let total: Int
  }

  @MainActor
  func testSearchNavigationAndEscapeRestoresTerminalFocus() async throws {
    preservePasteboards()
    let terminal = terminalElement()
    let needle = "SUPATERMSEARCHNEEDLE"
    try await runCommand(
      printfCommand("\(needle) \(needle) \(needle)"),
      showing: needle,
      in: terminal
    )

    app.typeKey("f", modifierFlags: .command)

    let searchField = app.textFields[AccessibilityIdentifier.searchField]
    XCTAssertTrue(searchField.waitForExistence(timeout: 10))
    searchField.typeText(needle)
    XCTAssertEqual(searchField.value as? String, needle)

    let matchLabel = app.staticTexts[AccessibilityIdentifier.searchMatchCount]
    let foundMatches = await wait(for: matchLabel, timeout: .seconds(30)) {
      self.matchCount(from: $0) != nil
    }
    XCTAssertTrue(foundMatches)
    let initialMatch = try XCTUnwrap(matchCount(from: matchLabel))
    XCTAssertGreaterThan(initialMatch.total, 1)

    try clickMenuItem(.findNext)
    let selectedMatch = await wait(for: matchLabel) {
      guard let count = self.matchCount(from: $0) else { return false }
      return count.total == initialMatch.total && count.current != nil
    }
    XCTAssertTrue(selectedMatch)
    let firstMatch = try XCTUnwrap(matchCount(from: matchLabel))

    try clickMenuItem(.findNext)
    let navigatedNext = await wait(for: matchLabel) {
      guard let count = self.matchCount(from: $0) else { return false }
      return count.total == firstMatch.total && count.current != firstMatch.current
    }
    XCTAssertTrue(navigatedNext)

    try clickMenuItem(.findPrevious)
    let navigatedPrevious = await wait(for: matchLabel) {
      self.matchCount(from: $0) == firstMatch
    }
    XCTAssertTrue(navigatedPrevious)

    searchField.click()
    app.typeKey(.escape, modifierFlags: [])
    let searchClosed = await wait(for: searchField) { !$0.exists }
    XCTAssertTrue(searchClosed)

    let focusProbe = "TERMINALFOCUSRESTORED"
    app.typeText(focusProbe)
    let terminalReceivedInput = await wait(for: terminal) {
      ($0.value as? String)?.hasSuffix(focusProbe) == true
    }
    XCTAssertTrue(terminalReceivedInput)
  }

  @MainActor
  func testSelectionForFindSeedsSearchField() async throws {
    preservePasteboards()
    let terminal = terminalElement()
    let selection = "SUPATERMSELECTIONFIND"
    try await printAtTopAndSelect(selection, in: terminal)

    app.typeKey("e", modifierFlags: .command)

    let searchField = app.textFields[AccessibilityIdentifier.searchField]
    XCTAssertTrue(searchField.waitForExistence(timeout: 10))
    let seededSelection = await wait(for: searchField) {
      ($0.value as? String) == selection
    }
    XCTAssertTrue(seededSelection)
  }

  @MainActor
  func testCopyPasteAndPasteSelectionRoundTrip() async throws {
    preservePasteboards()
    let terminal = terminalElement()
    let selection = "SUPATERMCOPYROUNDTRIP"
    try await printAtTopAndSelect(selection, in: terminal)

    app.typeKey("c", modifierFlags: .command)
    let copied = await wait(for: terminal) { _ in
      NSPasteboard.general.string(forType: .string) == selection
    }
    XCTAssertTrue(copied)

    terminal.click()
    let occurrencesBeforePaste = occurrences(of: selection, in: terminalText(terminal))
    app.typeKey("v", modifierFlags: .command)
    let pasted = await wait(for: terminal) {
      self.occurrences(of: selection, in: self.terminalText($0)) == occurrencesBeforePaste + 1
    }
    XCTAssertTrue(pasted)

    app.typeKey("u", modifierFlags: .control)
    let clearedInput = await wait(for: terminal) {
      self.occurrences(of: selection, in: self.terminalText($0)) == occurrencesBeforePaste
    }
    XCTAssertTrue(clearedInput)

    try clickMenuItem(.pasteSelection)
    let pastedSelection = await wait(for: terminal) {
      self.occurrences(of: selection, in: self.terminalText($0)) == occurrencesBeforePaste + 1
    }
    XCTAssertTrue(pastedSelection)
  }

  @MainActor
  func testUnsafePasteCanBeCancelledAndConfirmed() async throws {
    preservePasteboards()
    let terminal = terminalElement()
    let cancelPrefix = "SUPATERMCANCELLED"
    replacePasteboard(with: "\(cancelPrefix)\u{1B}[201~PASTE")

    app.typeKey("v", modifierFlags: .command)
    let cancelButton = app.buttons[AccessibilityIdentifier.clipboardCancel]
    XCTAssertTrue(cancelButton.waitForExistence(timeout: 10))
    cancelButton.click()
    let cancelled = await wait(for: cancelButton) { !$0.exists }
    XCTAssertTrue(cancelled)

    let cancelProbe = "CANCELPATHRETURNED"
    app.typeText(cancelProbe)
    let terminalReceivedProbe = await wait(for: terminal) {
      ($0.value as? String)?.hasSuffix(cancelProbe) == true
    }
    XCTAssertTrue(terminalReceivedProbe)
    XCTAssertFalse(terminalText(terminal).contains(cancelPrefix))

    app.typeKey("u", modifierFlags: .control)
    let clearedProbe = await wait(for: terminal) {
      ($0.value as? String)?.hasSuffix(cancelProbe) == false
    }
    XCTAssertTrue(clearedProbe)

    let confirmPrefix = "SUPATERMCONFIRMED"
    let confirmSuffix = "[201~PASTE"
    replacePasteboard(with: "\(confirmPrefix)\u{1B}\(confirmSuffix)")
    app.typeKey("v", modifierFlags: .command)

    let confirmButton = app.buttons[AccessibilityIdentifier.clipboardConfirm]
    XCTAssertTrue(confirmButton.waitForExistence(timeout: 10))
    confirmButton.click()
    let confirmed = await wait(for: confirmButton) { !$0.exists }
    XCTAssertTrue(confirmed)
    let terminalReceivedPaste = await wait(for: terminal) {
      let text = self.terminalText($0)
      return text.contains(confirmPrefix) && text.contains(confirmSuffix)
    }
    XCTAssertTrue(terminalReceivedPaste)
  }

  @MainActor
  private func terminalElement() -> XCUIElement {
    _ = mainWindow
    let terminal = app.textViews.firstMatch
    XCTAssertTrue(terminal.waitForExistence(timeout: 30))
    terminal.click()
    return terminal
  }

  @MainActor
  private func runCommand(
    _ command: String,
    showing expectedText: String,
    in terminal: XCUIElement
  ) async throws {
    app.typeText(command)
    app.typeKey(.return, modifierFlags: [])
    let commandCompleted = await wait(for: terminal, timeout: .seconds(30)) {
      ($0.value as? String)?.contains(expectedText) == true
    }
    XCTAssertTrue(commandCompleted)
  }

  @MainActor
  private func printAtTopAndSelect(
    _ text: String,
    in terminal: XCUIElement
  ) async throws {
    try await runCommand("clear; \(printfCommand(text))", showing: text, in: terminal)
    let origin = terminal.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    origin.withOffset(CGVector(dx: 48, dy: 12)).doubleClick()
    let selectionCopied = await wait(for: terminal) { _ in
      ghosttySelectionPasteboard.string(forType: .string) == text
    }
    XCTAssertTrue(selectionCopied)
  }

  private func printfCommand(_ text: String) -> String {
    let escaped = text.utf8.map { String(format: "\\x%02X", $0) }.joined()
    return "printf '\(escaped)\\n'"
  }

  @MainActor
  private func matchCount(from element: XCUIElement) -> MatchCount? {
    let parts = element.label.split(separator: "/", omittingEmptySubsequences: false)
    guard
      parts.count == 2,
      let total = Int(parts[1])
    else { return nil }
    let current: Int?
    if parts[0] == "-" {
      current = nil
    } else {
      guard let value = Int(parts[0]) else { return nil }
      current = value
    }
    return MatchCount(current: current, total: total)
  }

  @MainActor
  private func terminalText(_ terminal: XCUIElement) -> String {
    terminal.value as? String ?? ""
  }

  private func occurrences(of needle: String, in text: String) -> Int {
    text.components(separatedBy: needle).count - 1
  }
}

extension SupatermUITestCase {
  @MainActor
  var ghosttySelectionPasteboard: NSPasteboard {
    NSPasteboard(name: NSPasteboard.Name("com.mitchellh.ghostty.selection"))
  }

  @MainActor
  func preservePasteboards() {
    let pasteboards = [NSPasteboard.general, ghosttySelectionPasteboard]
    let snapshots = pasteboards.map { pasteboard in
      (pasteboard, pasteboardSnapshot(of: pasteboard))
    }
    addTeardownBlock {
      for (pasteboard, items) in snapshots {
        pasteboard.clearContents()
        _ = pasteboard.writeObjects(items)
      }
    }
  }

  @MainActor
  func replacePasteboard(with string: String) {
    NSPasteboard.general.clearContents()
    XCTAssertTrue(NSPasteboard.general.setString(string, forType: .string))
  }

  @MainActor
  private func pasteboardSnapshot(of pasteboard: NSPasteboard) -> [NSPasteboardItem] {
    pasteboard.pasteboardItems?.map { item in
      let snapshot = NSPasteboardItem()
      for type in item.types {
        if let data = item.data(forType: type) {
          snapshot.setData(data, forType: type)
        }
      }
      return snapshot
    } ?? []
  }
}
