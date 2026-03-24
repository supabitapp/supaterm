import AppKit

final class TerminalWindow: NSWindow {
  override var contentLayoutRect: CGRect {
    var rect = super.contentLayoutRect
    rect.origin.y = 0
    rect.size.height = frame.height
    return rect
  }
}
