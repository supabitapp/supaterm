import AppKit
import CoreText
import GhosttyKit
import SupatermCLIShared

extension GhosttySurfaceView {
  public func setAccessibilityPaneIndex(index: Int, total: Int) {
    guard total > 0, index > 0, index <= total else {
      accessibilityPaneIndexHelp = nil
      return
    }
    accessibilityPaneIndexHelp = "Pane \(index) of \(total)"
  }

  public override func isAccessibilityElement() -> Bool {
    surface != nil
  }

  public override func accessibilityRole() -> NSAccessibility.Role? {
    .textArea
  }

  public override func accessibilityLabel() -> String? {
    if let title = bridge.state.effectiveTitle {
      return title
    }
    let pwd = bridge.state.pwd?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !pwd.isEmpty {
      return pwd
    }
    return "Terminal pane"
  }

  public override func accessibilityValue() -> Any? {
    cachedScreenContentsValue()
  }

  public override func accessibilityHelp() -> String? {
    accessibilityPaneIndexHelp
  }

  public override func accessibilitySelectedTextRange() -> NSRange {
    selectedRange()
  }

  public override func accessibilitySelectedText() -> String? {
    guard let surface else { return nil }
    var text = ghostty_text_s()
    guard ghostty_surface_read_selection(surface, &text) else { return nil }
    defer { ghostty_surface_free_text(surface, &text) }
    let value = String(cString: text.text)
    return value.isEmpty ? nil : value
  }

  public override func accessibilityNumberOfCharacters() -> Int {
    cachedScreenContentsValue().count
  }

  public override func accessibilityVisibleCharacterRange() -> NSRange {
    let content = cachedScreenContentsValue()
    return NSRange(location: 0, length: content.count)
  }

  public override func accessibilityLine(for index: Int) -> Int {
    Self.accessibilityLine(for: index, in: cachedScreenContentsValue())
  }

  public override func accessibilityString(for range: NSRange) -> String? {
    Self.accessibilityString(for: range, in: cachedScreenContentsValue())
  }

  public override func accessibilityAttributedString(for range: NSRange) -> NSAttributedString? {
    guard let surface else { return nil }
    guard let plainString = accessibilityString(for: range) else { return nil }

    var attributes: [NSAttributedString.Key: Any] = [:]
    if let fontRaw = ghostty_surface_quicklook_font(surface) {
      let font = Unmanaged<CTFont>.fromOpaque(fontRaw)
      attributes[.font] = font.takeUnretainedValue()
      font.release()
    }

    return NSAttributedString(string: plainString, attributes: attributes)
  }

  public override func becomeFirstResponder() -> Bool {
    let result = super.becomeFirstResponder()
    if result {
      focusDidChange(true)
      postAccessibilityFocusChanged()
    }
    return result
  }

  public override func resignFirstResponder() -> Bool {
    let result = super.resignFirstResponder()
    if result {
      focusDidChange(false)
    }
    return result
  }

  func readScreenContents() -> String {
    readText(
      topLeftTag: GHOSTTY_POINT_SCREEN,
      bottomRightTag: GHOSTTY_POINT_SCREEN
    ) ?? ""
  }

  public func captureText(
    scope: SupatermCapturePaneScope,
    lines: Int?
  ) -> String? {
    let text =
      switch scope {
      case .scrollback:
        readText(
          topLeftTag: GHOSTTY_POINT_SURFACE,
          bottomRightTag: GHOSTTY_POINT_SCREEN
        )
      case .visible:
        readText(
          topLeftTag: GHOSTTY_POINT_SCREEN,
          bottomRightTag: GHOSTTY_POINT_SCREEN
        )
      }
    guard let text else { return nil }
    guard let lines, lines > 0 else { return text }
    let components = text.components(separatedBy: .newlines)
    guard components.count > lines else { return text }
    return components.suffix(lines).joined(separator: "\n")
  }

  private func postAccessibilityFocusChanged() {
    guard surface != nil else { return }
    if let window {
      NSAccessibility.post(element: window, notification: .focusedUIElementChanged)
    } else {
      NSAccessibility.post(element: self, notification: .focusedUIElementChanged)
    }
  }

  private func readText(
    topLeftTag: ghostty_point_tag_e,
    bottomRightTag: ghostty_point_tag_e
  ) -> String? {
    guard let surface else { return nil }
    var text = ghostty_text_s()
    let selection = ghostty_selection_s(
      top_left: ghostty_point_s(
        tag: topLeftTag,
        coord: GHOSTTY_POINT_COORD_TOP_LEFT,
        x: 0,
        y: 0
      ),
      bottom_right: ghostty_point_s(
        tag: bottomRightTag,
        coord: GHOSTTY_POINT_COORD_BOTTOM_RIGHT,
        x: 0,
        y: 0
      ),
      rectangle: false
    )
    guard ghostty_surface_read_text(surface, selection, &text) else { return nil }
    defer { ghostty_surface_free_text(surface, &text) }
    return String(cString: text.text)
  }
}
