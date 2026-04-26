import AppKit
import CoreGraphics
import Darwin
import Foundation
import SupatermCLIShared

struct ComputerUseMouseWindow: Equatable {
  let id: UInt32
  let frame: SupatermComputerUseRect
}

struct ComputerUseMouseClick: Equatable {
  let point: CGPoint
  let pid: pid_t
  let window: ComputerUseMouseWindow
  let button: SupatermComputerUseClickButton
  let count: Int
  let modifiers: [SupatermComputerUseClickModifier]
}

enum ComputerUseMouseDispatch: String, Equatable {
  case accessibility
  case hidEvent = "hid_event"
  case skyLightEvent = "skylight_event"
  case pidEvent = "pid_event"
}

enum ComputerUseMouseInput {
  private struct BridgedEventContext {
    let buttonNumber: Int64
    let windowNumber: Int
  }

  static func dispatch(
    isTargetActive: Bool,
    button: SupatermComputerUseClickButton,
    count: Int,
    modifiers: [SupatermComputerUseClickModifier],
    skyLightAvailable: Bool
  ) -> ComputerUseMouseDispatch {
    if isTargetActive {
      return .hidEvent
    }
    let clickCount = normalizedCount(count)
    let skyLightClickCount = clickCount == 1 || clickCount == 2
    if skyLightAvailable, button == .left, skyLightClickCount, modifiers.isEmpty {
      return .skyLightEvent
    }
    return .pidEvent
  }

  static func click(_ click: ComputerUseMouseClick) throws -> ComputerUseMouseDispatch {
    let route = dispatch(
      isTargetActive: NSRunningApplication(processIdentifier: click.pid)?.isActive ?? false,
      button: click.button,
      count: click.count,
      modifiers: click.modifiers,
      skyLightAvailable: ComputerUseSkyLightEventPost.isAvailable
    )
    switch route {
    case .accessibility:
      return route
    case .hidEvent:
      try clickFrontmostViaHIDTap(
        at: click.point,
        button: click.button,
        count: click.count,
        modifiers: click.modifiers
      )
    case .skyLightEvent:
      try clickViaSkyLightPost(click)
    case .pidEvent:
      try clickViaBridgedPidPost(click)
    }
    return route
  }

  private static func clickViaSkyLightPost(_ click: ComputerUseMouseClick) throws {
    let clickPairs = min(2, normalizedCount(click.count))
    let windowID = Int64(click.window.id)
    let windowNumber = Int(windowID)
    let localPoint = CGPoint(
      x: click.point.x - click.window.frame.x,
      y: click.point.y - click.window.frame.y
    )

    if click.window.id != 0 {
      _ = ComputerUseFocusWithoutRaise.activate(
        targetPid: click.pid,
        targetWindowID: CGWindowID(click.window.id)
      )
      usleep(50_000)
    }

    func makeEvent(_ type: NSEvent.EventType, clickCount: Int) throws -> CGEvent {
      guard
        let event = NSEvent.mouseEvent(
          with: type,
          location: .zero,
          modifierFlags: [],
          timestamp: 0,
          windowNumber: windowNumber,
          context: nil,
          eventNumber: 0,
          clickCount: clickCount,
          pressure: 1
        )?.cgEvent
      else {
        throw ComputerUseError.unsupportedBackgroundTarget
      }
      return event
    }

    func stamp(_ event: CGEvent, screenPoint: CGPoint, windowPoint: CGPoint, clickState: Int64) {
      event.location = screenPoint
      event.setIntegerValueField(.mouseEventButtonNumber, value: 0)
      event.setIntegerValueField(.mouseEventSubtype, value: 3)
      event.setIntegerValueField(.mouseEventClickState, value: clickState)
      if windowID != 0 {
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: windowID)
        event.setIntegerValueField(
          .mouseEventWindowUnderMousePointerThatCanHandleThisEvent,
          value: windowID
        )
      }
      _ = ComputerUseSkyLightEventPost.setWindowLocation(event, windowPoint)
      _ = ComputerUseSkyLightEventPost.setIntegerField(event, field: 40, value: Int64(click.pid))
    }

    let move = try makeEvent(.mouseMoved, clickCount: 0)
    stamp(move, screenPoint: click.point, windowPoint: localPoint, clickState: 1)

    let offscreen = CGPoint(x: -1, y: -1)
    let primerDown = try makeEvent(.leftMouseDown, clickCount: 1)
    let primerUp = try makeEvent(.leftMouseUp, clickCount: 1)
    stamp(primerDown, screenPoint: offscreen, windowPoint: offscreen, clickState: 1)
    stamp(primerUp, screenPoint: offscreen, windowPoint: offscreen, clickState: 1)

    var targetPairs: [(down: CGEvent, up: CGEvent)] = []
    for pairIndex in 1...clickPairs {
      let down = try makeEvent(.leftMouseDown, clickCount: pairIndex)
      let up = try makeEvent(.leftMouseUp, clickCount: pairIndex)
      let clickState = Int64(pairIndex)
      stamp(down, screenPoint: click.point, windowPoint: localPoint, clickState: clickState)
      stamp(up, screenPoint: click.point, windowPoint: localPoint, clickState: clickState)
      targetPairs.append((down, up))
    }

    func post(_ event: CGEvent) {
      event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
      _ = ComputerUseSkyLightEventPost.postToPid(
        click.pid,
        event: event,
        attachAuthMessage: false
      )
    }

    post(move)
    usleep(15_000)
    post(primerDown)
    usleep(1_000)
    post(primerUp)
    usleep(100_000)
    for (index, pair) in targetPairs.enumerated() {
      post(pair.down)
      usleep(1_000)
      post(pair.up)
      if index < targetPairs.count - 1 {
        usleep(80_000)
      }
    }
  }

  private static func clickViaBridgedPidPost(_ click: ComputerUseMouseClick) throws {
    let clickCount = normalizedCount(click.count)
    let (downType, upType) = nsEventTypes(for: click.button)
    let modifierFlags = nsEventFlags(for: click.modifiers)
    let location = cocoaLocation(from: click.point)
    let context = BridgedEventContext(
      buttonNumber: mouseButtonNumber(for: click.button),
      windowNumber: Int(click.window.id)
    )

    for clickIndex in 1...clickCount {
      let down = try buildCGEvent(
        type: downType,
        location: location,
        modifierFlags: modifierFlags,
        clickCount: clickIndex,
        context: context
      )
      let up = try buildCGEvent(
        type: upType,
        location: location,
        modifierFlags: modifierFlags,
        clickCount: clickIndex,
        context: context
      )
      down.setIntegerValueField(.mouseEventClickState, value: Int64(clickIndex))
      up.setIntegerValueField(.mouseEventClickState, value: Int64(clickIndex))

      postBoth(down, toPid: click.pid)
      usleep(30_000)
      postBoth(up, toPid: click.pid)
      if clickIndex < clickCount {
        usleep(80_000)
      }
    }
  }

  private static func clickFrontmostViaHIDTap(
    at point: CGPoint,
    button: SupatermComputerUseClickButton,
    count: Int,
    modifiers: [SupatermComputerUseClickModifier]
  ) throws {
    let clickCount = normalizedCount(count)
    let (downType, upType) = cgEventTypes(for: button)
    let mouseButton = cgMouseButton(for: button)
    let modifierFlags = cgEventFlags(for: modifiers)
    let source = CGEventSource(stateID: .hidSystemState)

    guard
      let move = CGEvent(
        mouseEventSource: source,
        mouseType: .mouseMoved,
        mouseCursorPosition: point,
        mouseButton: mouseButton
      )
    else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    move.flags = modifierFlags
    move.post(tap: .cghidEventTap)
    usleep(30_000)

    for clickIndex in 1...clickCount {
      guard
        let down = CGEvent(
          mouseEventSource: source,
          mouseType: downType,
          mouseCursorPosition: point,
          mouseButton: mouseButton
        ),
        let up = CGEvent(
          mouseEventSource: source,
          mouseType: upType,
          mouseCursorPosition: point,
          mouseButton: mouseButton
        )
      else {
        throw ComputerUseError.unsupportedBackgroundTarget
      }
      down.flags = modifierFlags
      up.flags = modifierFlags
      down.setIntegerValueField(.mouseEventClickState, value: Int64(clickIndex))
      up.setIntegerValueField(.mouseEventClickState, value: Int64(clickIndex))
      down.post(tap: .cghidEventTap)
      usleep(20_000)
      up.post(tap: .cghidEventTap)
      if clickIndex < clickCount {
        usleep(80_000)
      }
    }
  }

  private static func buildCGEvent(
    type: NSEvent.EventType,
    location: CGPoint,
    modifierFlags: NSEvent.ModifierFlags,
    clickCount: Int,
    context: BridgedEventContext
  ) throws -> CGEvent {
    guard
      let event = NSEvent.mouseEvent(
        with: type,
        location: location,
        modifierFlags: modifierFlags,
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: context.windowNumber,
        context: nil,
        eventNumber: 0,
        clickCount: clickCount,
        pressure: 1
      )?.cgEvent
    else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    event.setIntegerValueField(.mouseEventButtonNumber, value: context.buttonNumber)
    return event
  }

  private static func postBoth(_ event: CGEvent, toPid pid: pid_t) {
    _ = ComputerUseSkyLightEventPost.postToPid(pid, event: event)
    event.postToPid(pid)
  }

  private static func normalizedCount(_ count: Int) -> Int {
    max(1, min(3, count))
  }

  private static func cgEventTypes(
    for button: SupatermComputerUseClickButton
  ) -> (down: CGEventType, up: CGEventType) {
    switch button {
    case .left:
      return (.leftMouseDown, .leftMouseUp)
    case .right:
      return (.rightMouseDown, .rightMouseUp)
    case .middle:
      return (.otherMouseDown, .otherMouseUp)
    }
  }

  private static func nsEventTypes(
    for button: SupatermComputerUseClickButton
  ) -> (down: NSEvent.EventType, up: NSEvent.EventType) {
    switch button {
    case .left:
      return (.leftMouseDown, .leftMouseUp)
    case .right:
      return (.rightMouseDown, .rightMouseUp)
    case .middle:
      return (.otherMouseDown, .otherMouseUp)
    }
  }

  private static func cgMouseButton(for button: SupatermComputerUseClickButton) -> CGMouseButton {
    switch button {
    case .left:
      return .left
    case .right:
      return .right
    case .middle:
      return .center
    }
  }

  private static func mouseButtonNumber(for button: SupatermComputerUseClickButton) -> Int64 {
    switch button {
    case .left:
      return 0
    case .right:
      return 1
    case .middle:
      return 2
    }
  }

  private static func cgEventFlags(
    for modifiers: [SupatermComputerUseClickModifier]
  ) -> CGEventFlags {
    modifiers.reduce(into: []) { flags, modifier in
      switch modifier {
      case .command:
        flags.insert(.maskCommand)
      case .shift:
        flags.insert(.maskShift)
      case .option:
        flags.insert(.maskAlternate)
      case .control:
        flags.insert(.maskControl)
      case .function:
        flags.insert(.maskSecondaryFn)
      }
    }
  }

  private static func nsEventFlags(
    for modifiers: [SupatermComputerUseClickModifier]
  ) -> NSEvent.ModifierFlags {
    modifiers.reduce(into: []) { flags, modifier in
      switch modifier {
      case .command:
        flags.insert(.command)
      case .shift:
        flags.insert(.shift)
      case .option:
        flags.insert(.option)
      case .control:
        flags.insert(.control)
      case .function:
        flags.insert(.function)
      }
    }
  }

  private static func cocoaLocation(from point: CGPoint) -> CGPoint {
    let height = NSScreen.main?.frame.height ?? NSScreen.screens.first?.frame.height ?? 0
    return .init(x: point.x, y: height - point.y)
  }
}
