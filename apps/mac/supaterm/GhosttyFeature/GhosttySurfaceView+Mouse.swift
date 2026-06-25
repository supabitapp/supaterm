import AppKit
import CoreText
import GhosttyKit

extension GhosttySurfaceView {
  private static let mouseCursorMap: [ghostty_action_mouse_shape_e: NSCursor] = [
    GHOSTTY_MOUSE_SHAPE_DEFAULT: .arrow,
    GHOSTTY_MOUSE_SHAPE_TEXT: .iBeam,
    GHOSTTY_MOUSE_SHAPE_GRAB: .openHand,
    GHOSTTY_MOUSE_SHAPE_GRABBING: .closedHand,
    GHOSTTY_MOUSE_SHAPE_POINTER: .pointingHand,
    GHOSTTY_MOUSE_SHAPE_VERTICAL_TEXT: .iBeamCursorForVerticalLayout,
    GHOSTTY_MOUSE_SHAPE_CONTEXT_MENU: .contextualMenu,
    GHOSTTY_MOUSE_SHAPE_CROSSHAIR: .crosshair,
    GHOSTTY_MOUSE_SHAPE_NOT_ALLOWED: .operationNotAllowed,
  ]

  private static let mouseResizeLeftRightShapes: Set<ghostty_action_mouse_shape_e> = [
    GHOSTTY_MOUSE_SHAPE_COL_RESIZE,
    GHOSTTY_MOUSE_SHAPE_W_RESIZE,
    GHOSTTY_MOUSE_SHAPE_E_RESIZE,
    GHOSTTY_MOUSE_SHAPE_EW_RESIZE,
  ]

  private static let mouseResizeUpDownShapes: Set<ghostty_action_mouse_shape_e> = [
    GHOSTTY_MOUSE_SHAPE_ROW_RESIZE,
    GHOSTTY_MOUSE_SHAPE_N_RESIZE,
    GHOSTTY_MOUSE_SHAPE_S_RESIZE,
    GHOSTTY_MOUSE_SHAPE_NS_RESIZE,
  ]

  public override func mouseMoved(with event: NSEvent) {
    sendMousePosition(event)
    if let window, shouldRequestFocusOnMouseMoved(in: window) {
      requestFocus()
    }
  }

  public override func mouseEntered(with event: NSEvent) {
    super.mouseEntered(with: event)
    sendMousePosition(event)
  }

  public override func mouseExited(with event: NSEvent) {
    if NSEvent.pressedMouseButtons != 0 {
      return
    }
    guard let surface else { return }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    ghostty_surface_mouse_pos(surface, -1, -1, mods)
  }

  public override func mouseDown(with event: NSEvent) {
    if focused {
      onDirectInteraction?()
    }
    sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS, button: GHOSTTY_MOUSE_LEFT)
  }

  public override func mouseUp(with event: NSEvent) {
    prevPressureStage = 0
    sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE, button: GHOSTTY_MOUSE_LEFT)
    if let surface {
      ghostty_surface_mouse_pressure(surface, 0, 0)
    }
  }

  public override func rightMouseDown(with event: NSEvent) {
    guard let surface else {
      super.rightMouseDown(with: event)
      return
    }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    if ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, mods) {
      return
    }
    super.rightMouseDown(with: event)
  }

  public override func rightMouseUp(with event: NSEvent) {
    guard let surface else {
      super.rightMouseUp(with: event)
      return
    }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    if ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT, mods) {
      return
    }
    super.rightMouseUp(with: event)
  }

  public override func otherMouseDown(with event: NSEvent) {
    sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS, button: Self.ghosttyMouseButton(from: event.buttonNumber))
  }

  public override func otherMouseUp(with event: NSEvent) {
    sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE, button: Self.ghosttyMouseButton(from: event.buttonNumber))
  }

  private static func ghosttyMouseButton(from buttonNumber: Int) -> ghostty_input_mouse_button_e {
    switch buttonNumber {
    case 0: GHOSTTY_MOUSE_LEFT
    case 1: GHOSTTY_MOUSE_RIGHT
    case 2: GHOSTTY_MOUSE_MIDDLE
    case 3: GHOSTTY_MOUSE_EIGHT
    case 4: GHOSTTY_MOUSE_NINE
    case 5: GHOSTTY_MOUSE_SIX
    case 6: GHOSTTY_MOUSE_SEVEN
    case 7: GHOSTTY_MOUSE_FOUR
    case 8: GHOSTTY_MOUSE_FIVE
    case 9: GHOSTTY_MOUSE_TEN
    case 10: GHOSTTY_MOUSE_ELEVEN
    default: GHOSTTY_MOUSE_UNKNOWN
    }
  }

  public override func mouseDragged(with event: NSEvent) {
    sendMousePosition(event)
  }

  public override func rightMouseDragged(with event: NSEvent) {
    sendMousePosition(event)
  }

  public override func otherMouseDragged(with event: NSEvent) {
    sendMousePosition(event)
  }

  public override func scrollWheel(with event: NSEvent) {
    if focused {
      onDirectInteraction?()
    }
    guard let surface else { return }
    var scrollX = event.scrollingDeltaX
    var scrollY = event.scrollingDeltaY
    if event.hasPreciseScrollingDeltas {
      scrollX *= 2
      scrollY *= 2
    }
    ghostty_surface_mouse_scroll(surface, scrollX, scrollY, scrollMods(for: event))
  }

  public override func pressureChange(with event: NSEvent) {
    guard let surface else { return }
    ghostty_surface_mouse_pressure(surface, UInt32(event.stage), Double(event.pressure))
    guard prevPressureStage < 2 else { return }
    prevPressureStage = event.stage
    guard event.stage == 2 else { return }
    guard UserDefaults.standard.bool(forKey: "com.apple.trackpad.forceClick") else { return }
    quickLook(with: event)
  }

  public override func quickLook(with event: NSEvent) {
    guard let surface else { return super.quickLook(with: event) }
    var text = ghostty_text_s()
    guard ghostty_surface_quicklook_word(surface, &text) else { return super.quickLook(with: event) }
    defer { ghostty_surface_free_text(surface, &text) }
    guard text.text_len > 0 else { return super.quickLook(with: event) }

    var attributes: [NSAttributedString.Key: Any] = [:]
    if let fontRaw = ghostty_surface_quicklook_font(surface) {
      let font = Unmanaged<CTFont>.fromOpaque(fontRaw)
      attributes[.font] = font.takeUnretainedValue()
      font.release()
    }

    let str = NSAttributedString(string: String(cString: text.text), attributes: attributes)
    let point = NSPoint(x: text.tl_px_x, y: frame.size.height - text.tl_px_y)
    showDefinition(for: str, at: point)
  }

  func setMouseShape(_ shape: ghostty_action_mouse_shape_e) {
    let newCursor = cursor(for: shape)
    guard let newCursor else { return }
    guard newCursor != currentCursor else { return }
    currentCursor = newCursor
    window?.invalidateCursorRects(for: self)
  }

  private func cursor(for shape: ghostty_action_mouse_shape_e) -> NSCursor? {
    if let cursor = Self.mouseCursorMap[shape] {
      return cursor
    }
    if Self.mouseResizeLeftRightShapes.contains(shape) {
      return .resizeLeftRight
    }
    if Self.mouseResizeUpDownShapes.contains(shape) {
      return .resizeUpDown
    }
    return nil
  }

  func setMouseVisibility(_ visible: Bool) {
    NSCursor.setHiddenUntilMouseMoves(!visible)
  }

  private func scrollMods(for event: NSEvent) -> ghostty_input_scroll_mods_t {
    var value: Int32 = 0
    if event.hasPreciseScrollingDeltas {
      value |= 0b0000_0001
    }
    let momentum: Int32
    switch event.momentumPhase {
    case .began:
      momentum = 1
    case .stationary:
      momentum = 2
    case .changed:
      momentum = 3
    case .ended:
      momentum = 4
    case .cancelled:
      momentum = 5
    case .mayBegin:
      momentum = 6
    default:
      momentum = 0
    }
    value |= (momentum << 1)
    return ghostty_input_scroll_mods_t(value)
  }

  private func sendMousePosition(_ event: NSEvent) {
    guard let surface else { return }
    let point = convert(event.locationInWindow, from: nil)
    let yPosition = bounds.height - point.y
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    ghostty_surface_mouse_pos(surface, point.x, yPosition, mods)
  }

  private func sendMouseButton(
    _ event: NSEvent,
    state: ghostty_input_mouse_state_e,
    button: ghostty_input_mouse_button_e
  ) {
    guard let surface else { return }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    ghostty_surface_mouse_button(surface, state, button, mods)
  }
}
