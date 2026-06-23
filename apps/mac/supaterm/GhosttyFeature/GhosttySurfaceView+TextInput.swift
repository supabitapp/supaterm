import AppKit
import CoreText
import GhosttyKit

extension GhosttySurfaceView: NSTextInputClient {
  public func hasMarkedText() -> Bool {
    markedText.length > 0
  }

  public func markedRange() -> NSRange {
    guard markedText.length > 0 else { return NSRange() }
    return NSRange(location: 0, length: markedText.length)
  }

  public func selectedRange() -> NSRange {
    guard let surface else { return NSRange() }
    var text = ghostty_text_s()
    guard ghostty_surface_read_selection(surface, &text) else { return NSRange() }
    defer { ghostty_surface_free_text(surface, &text) }
    return NSRange(location: Int(text.offset_start), length: Int(text.offset_len))
  }

  public func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
    switch string {
    case let attributedText as NSAttributedString:
      markedText = NSMutableAttributedString(attributedString: attributedText)
    case let stringValue as String:
      markedText = NSMutableAttributedString(string: stringValue)
    default:
      return
    }
    if keyTextAccumulator == nil {
      syncPreedit()
    }
  }

  public func unmarkText() {
    if markedText.length > 0 {
      markedText.mutableString.setString("")
      syncPreedit()
    }
  }

  public func validAttributesForMarkedText() -> [NSAttributedString.Key] {
    []
  }

  public func attributedSubstring(
    forProposedRange range: NSRange,
    actualRange: NSRangePointer?
  ) -> NSAttributedString? {
    guard let surface else { return nil }
    guard range.length > 0 else { return nil }
    var text = ghostty_text_s()
    guard ghostty_surface_read_selection(surface, &text) else { return nil }
    defer { ghostty_surface_free_text(surface, &text) }
    var attributes: [NSAttributedString.Key: Any] = [:]
    if let fontRaw = ghostty_surface_quicklook_font(surface) {
      let font = Unmanaged<CTFont>.fromOpaque(fontRaw)
      attributes[.font] = font.takeUnretainedValue()
      font.release()
    }
    return NSAttributedString(string: String(cString: text.text), attributes: attributes)
  }

  public func characterIndex(for point: NSPoint) -> Int {
    0
  }

  public func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
    guard let surface else {
      return NSRect(x: frame.origin.x, y: frame.origin.y, width: 0, height: 0)
    }
    var caretX: Double = 0
    var caretY: Double = 0
    var width: Double = cellSize.width
    var height: Double = cellSize.height
    if range.length > 0, range != selectedRange() {
      var text = ghostty_text_s()
      if ghostty_surface_read_selection(surface, &text) {
        caretX = text.tl_px_x - 2
        caretY = text.tl_px_y + 2
        ghostty_surface_free_text(surface, &text)
      } else {
        ghostty_surface_ime_point(surface, &caretX, &caretY, &width, &height)
      }
    } else {
      ghostty_surface_ime_point(surface, &caretX, &caretY, &width, &height)
    }
    if range.length == 0, width > 0 {
      width = 0
      caretX += cellSize.width * Double(range.location + range.length)
    }
    let viewRect = NSRect(
      x: caretX,
      y: frame.size.height - caretY,
      width: width,
      height: max(height, cellSize.height)
    )
    let winRect = convert(viewRect, to: nil)
    guard let window else { return winRect }
    return window.convertToScreen(winRect)
  }

  public func insertText(_ string: Any, replacementRange: NSRange) {
    guard NSApp.currentEvent != nil else { return }
    guard let surface else { return }
    var chars = ""
    switch string {
    case let attributedText as NSAttributedString:
      chars = attributedText.string
    case let stringValue as String:
      chars = stringValue
    default:
      return
    }
    unmarkText()
    if var acc = keyTextAccumulator {
      acc.append(chars)
      keyTextAccumulator = acc
      return
    }
    let len = chars.utf8CString.count
    if len == 0 { return }
    chars.withCString { ptr in
      ghostty_surface_text(surface, ptr, UInt(len - 1))
    }
  }
}

extension GhosttySurfaceView: NSServicesMenuRequestor {
  public override func validRequestor(
    forSendType sendType: NSPasteboard.PasteboardType?,
    returnType: NSPasteboard.PasteboardType?
  ) -> Any? {
    let receivable: [NSPasteboard.PasteboardType] = [.string, NSPasteboard.PasteboardType("public.utf8-plain-text")]
    let sendable = receivable
    let sendableRequiresSelection = sendable

    if (returnType == nil || receivable.contains(returnType!))
      && (sendType == nil || sendable.contains(sendType!))
    {
      if let sendType, sendableRequiresSelection.contains(sendType) {
        if surface == nil || !ghostty_surface_has_selection(surface) {
          return super.validRequestor(forSendType: sendType, returnType: returnType)
        }
      }
      return self
    }
    return super.validRequestor(forSendType: sendType, returnType: returnType)
  }

  public func writeSelection(to pboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
    guard let surface else { return false }
    var text = ghostty_text_s()
    guard ghostty_surface_read_selection(surface, &text) else { return false }
    defer { ghostty_surface_free_text(surface, &text) }
    pboard.declareTypes([.string], owner: nil)
    pboard.setString(String(cString: text.text), forType: .string)
    return true
  }

  public func readSelection(from pboard: NSPasteboard) -> Bool {
    guard let str = pboard.getOpinionatedStringContents() else { return false }
    let len = str.utf8CString.count
    if len == 0 { return true }
    str.withCString { ptr in
      ghostty_surface_text(surface, ptr, UInt(len - 1))
    }
    return true
  }
}
