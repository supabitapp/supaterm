import AppKit

@MainActor
final class TerminalHorizontalTabInteraction {
  enum MiddleClickAction {
    case activate
    case close
  }

  enum Phase: Equatable {
    case idle
    case down
  }

  static let longPressDelay: TimeInterval = 0.3

  var middleClickAction = MiddleClickAction.activate
  var onMiddleActivate: (() -> Void)?
  var onContextMenu: ((NSEvent) -> Void)?
  var onDrag: ((NSEvent) -> Bool)?
  var onMiddleClose: (() -> Void)?
  var onPress: ((NSEvent) -> Void)?
  var onRelease: ((NSEvent) -> Void)?

  private(set) var phase = Phase.idle
  private var longPressEvent: NSEvent?
  private var longPressTimer: Timer?

  func mouseDown(with event: NSEvent) {
    cancel()
    if event.modifierFlags.contains(.control) {
      onContextMenu?(event)
      return
    }
    phase = .down
    onPress?(event)
    longPressEvent = event
    let timer = Timer(
      timeInterval: Self.longPressDelay,
      target: self,
      selector: #selector(fireLongPress),
      userInfo: nil,
      repeats: false
    )
    longPressTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  func mouseDragged(with event: NSEvent) {
    guard phase == .down else { return }
    cancelLongPress()
    if onDrag?(event) == true {
      phase = .idle
    }
  }

  func mouseUp(with event: NSEvent) {
    guard phase == .down else {
      cancelLongPress()
      return
    }
    phase = .idle
    cancelLongPress()
    onRelease?(event)
  }

  func mouseExited() {
    cancelLongPress()
  }

  func rightMouseDown(with event: NSEvent) {
    cancel()
    onContextMenu?(event)
  }

  func otherMouseUp(with event: NSEvent) -> Bool {
    guard event.buttonNumber == 2 else { return false }
    cancel()
    switch middleClickAction {
    case .activate:
      onMiddleActivate?()
    case .close:
      onMiddleClose?()
    }
    return true
  }

  func cancel() {
    phase = .idle
    cancelLongPress()
  }

  @objc private func fireLongPress() {
    guard phase == .down, let event = longPressEvent else {
      cancelLongPress()
      return
    }
    phase = .idle
    cancelLongPress()
    onContextMenu?(event)
  }

  private func cancelLongPress() {
    longPressTimer?.invalidate()
    longPressTimer = nil
    longPressEvent = nil
  }
}
