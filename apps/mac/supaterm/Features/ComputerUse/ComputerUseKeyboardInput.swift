import AppKit
import CoreGraphics
import Darwin
import Foundation
import SupatermCLIShared

enum ComputerUseKeyboardDispatch: String, Equatable {
  case skyLightEvent = "skylight_event"
  case pidEvent = "pid_event"
}

enum ComputerUseKeyboardInput {
  static func press(
    key: String,
    modifiers: [SupatermComputerUseKeyModifier],
    pid: pid_t
  ) throws -> ComputerUseKeyboardDispatch {
    guard let keyCode = keyCode(for: key) else {
      throw ComputerUseError.keyUnsupported(key)
    }
    let flags = eventFlags(for: modifiers)
    let dispatch = try postKey(code: keyCode, flags: flags, pid: pid)
    return dispatch
  }

  static func type(
    text: String,
    delayMilliseconds: Int,
    pid: pid_t
  ) throws -> ComputerUseKeyboardDispatch {
    guard !text.isEmpty else { return .pidEvent }
    let delay = UInt32(max(0, min(200, delayMilliseconds))) * 1_000
    var dispatch = ComputerUseKeyboardDispatch.pidEvent
    for character in text {
      dispatch = try postCharacter(character, pid: pid)
      if delay > 0 {
        usleep(delay)
      }
    }
    return dispatch
  }

  static func scrollKeys(
    direction: SupatermComputerUseScrollDirection,
    unit: SupatermComputerUseScrollUnit
  ) -> (key: String, modifiers: [SupatermComputerUseKeyModifier]) {
    switch (direction, unit) {
    case (.up, .line):
      return ("up", [])
    case (.down, .line):
      return ("down", [])
    case (.left, .line):
      return ("left", [])
    case (.right, .line):
      return ("right", [])
    case (.up, .page):
      return ("page-up", [])
    case (.down, .page):
      return ("page-down", [])
    case (.left, .page):
      return ("left", [.option])
    case (.right, .page):
      return ("right", [.option])
    }
  }

  private static func postKey(
    code: CGKeyCode,
    flags: CGEventFlags,
    pid: pid_t
  ) throws -> ComputerUseKeyboardDispatch {
    guard
      let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
      let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    down.flags = flags
    up.flags = flags
    let downPosted = ComputerUseSkyLightEventPost.postToPid(pid, event: down)
    let upPosted = ComputerUseSkyLightEventPost.postToPid(pid, event: up)
    if !downPosted {
      down.postToPid(pid)
    }
    if !upPosted {
      up.postToPid(pid)
    }
    return downPosted && upPosted ? .skyLightEvent : .pidEvent
  }

  private static func postCharacter(
    _ character: Character,
    pid: pid_t
  ) throws -> ComputerUseKeyboardDispatch {
    let utf16 = Array(String(character).utf16)
    var dispatch = ComputerUseKeyboardDispatch.skyLightEvent
    for isDown in [true, false] {
      guard
        let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: isDown)
      else {
        throw ComputerUseError.unsupportedBackgroundTarget
      }
      utf16.withUnsafeBufferPointer { buffer in
        if let base = buffer.baseAddress {
          event.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
        }
      }
      if !ComputerUseSkyLightEventPost.postToPid(pid, event: event) {
        event.postToPid(pid)
        dispatch = .pidEvent
      }
    }
    return dispatch
  }

  private static func keyCode(for key: String) -> CGKeyCode? {
    let normalized = key.lowercased()
    if let mapped = namedKeyCodes[normalized] {
      return mapped
    }
    if normalized.count == 1, let character = normalized.first {
      return characterKeyCodes[character]
    }
    return nil
  }

  private static func eventFlags(for modifiers: [SupatermComputerUseKeyModifier]) -> CGEventFlags {
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
      }
    }
  }

  private static let namedKeyCodes: [String: CGKeyCode] = [
    "return": 36,
    "enter": 36,
    "tab": 48,
    "space": 49,
    "delete": 51,
    "escape": 53,
    "esc": 53,
    "page-up": 116,
    "pageup": 116,
    "page-down": 121,
    "pagedown": 121,
    "home": 115,
    "end": 119,
    "left": 123,
    "right": 124,
    "down": 125,
    "up": 126,
  ]

  private static let characterKeyCodes: [Character: CGKeyCode] = [
    "a": 0,
    "s": 1,
    "d": 2,
    "f": 3,
    "h": 4,
    "g": 5,
    "z": 6,
    "x": 7,
    "c": 8,
    "v": 9,
    "b": 11,
    "q": 12,
    "w": 13,
    "e": 14,
    "r": 15,
    "y": 16,
    "t": 17,
    "1": 18,
    "2": 19,
    "3": 20,
    "4": 21,
    "6": 22,
    "5": 23,
    "=": 24,
    "9": 25,
    "7": 26,
    "-": 27,
    "8": 28,
    "0": 29,
    "]": 30,
    "o": 31,
    "u": 32,
    "[": 33,
    "i": 34,
    "p": 35,
    "l": 37,
    "j": 38,
    "'": 39,
    "k": 40,
    ";": 41,
    "\\": 42,
    ",": 43,
    "/": 44,
    "n": 45,
    "m": 46,
    ".": 47,
    "`": 50,
  ]
}
