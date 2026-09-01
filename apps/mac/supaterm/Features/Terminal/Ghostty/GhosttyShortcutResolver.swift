import AppKit
import Carbon.HIToolbox
import GhosttyKit
import SupatermSupport
import SwiftUI

struct GhosttyShortcut {
  let keyboardShortcut: KeyboardShortcut
  let physicalKeyCode: UInt16?

  init(
    keyboardShortcut: KeyboardShortcut,
    physicalKeyCode: UInt16? = nil
  ) {
    self.keyboardShortcut = keyboardShortcut
    self.physicalKeyCode = physicalKeyCode
  }
}

enum GhosttyShortcutResolver {
  static func shortcut(for trigger: ghostty_input_trigger_s) -> GhosttyShortcut? {
    let appKitModifiers = GhosttyKeyEvent.appKitMods(trigger.mods)
    let key: KeyEquivalent
    let physicalKeyCode: UInt16?
    switch trigger.tag {
    case GHOSTTY_TRIGGER_PHYSICAL:
      let physical = trigger.key.physical
      guard let physicalKey = physicalKeys[physical] else { return nil }
      physicalKeyCode = physicalKey.keyCode
      if let equivalent = physicalKey.keyEquivalent {
        key = equivalent
      } else {
        guard
          let character = SupatermKeyboardLayout.character(
            for: physicalKey.keyCode,
            modifiers: appKitModifiers.intersection(.command)
          )
        else { return nil }
        key = KeyEquivalent(character)
      }
    case GHOSTTY_TRIGGER_UNICODE:
      guard
        let scalar = UnicodeScalar(trigger.key.unicode),
        let normalized = Character(scalar).lowercased().first
      else { return nil }
      key = KeyEquivalent(normalized)
      physicalKeyCode = nil
    case GHOSTTY_TRIGGER_CATCH_ALL:
      return nil
    default:
      return nil
    }
    return GhosttyShortcut(
      keyboardShortcut: KeyboardShortcut(
        key,
        modifiers: eventModifiers(appKitModifiers)
      ),
      physicalKeyCode: physicalKeyCode
    )
  }

  private static func eventModifiers(
    _ modifiers: NSEvent.ModifierFlags
  ) -> SwiftUI.EventModifiers {
    var flags: SwiftUI.EventModifiers = []
    if modifiers.contains(.shift) { flags.insert(.shift) }
    if modifiers.contains(.control) { flags.insert(.control) }
    if modifiers.contains(.option) { flags.insert(.option) }
    if modifiers.contains(.command) { flags.insert(.command) }
    return flags
  }

  private struct PhysicalKey {
    let keyCode: UInt16
    let keyEquivalent: KeyEquivalent?

    init(_ keyCode: Int, keyEquivalent: KeyEquivalent? = nil) {
      self.keyCode = UInt16(keyCode)
      self.keyEquivalent = keyEquivalent
    }
  }

  private static let physicalKeys: [ghostty_input_key_e: PhysicalKey] = [
    GHOSTTY_KEY_BACKQUOTE: PhysicalKey(kVK_ANSI_Grave),
    GHOSTTY_KEY_BACKSLASH: PhysicalKey(kVK_ANSI_Backslash),
    GHOSTTY_KEY_BRACKET_LEFT: PhysicalKey(kVK_ANSI_LeftBracket),
    GHOSTTY_KEY_BRACKET_RIGHT: PhysicalKey(kVK_ANSI_RightBracket),
    GHOSTTY_KEY_COMMA: PhysicalKey(kVK_ANSI_Comma),
    GHOSTTY_KEY_DIGIT_0: PhysicalKey(kVK_ANSI_0),
    GHOSTTY_KEY_DIGIT_1: PhysicalKey(kVK_ANSI_1),
    GHOSTTY_KEY_DIGIT_2: PhysicalKey(kVK_ANSI_2),
    GHOSTTY_KEY_DIGIT_3: PhysicalKey(kVK_ANSI_3),
    GHOSTTY_KEY_DIGIT_4: PhysicalKey(kVK_ANSI_4),
    GHOSTTY_KEY_DIGIT_5: PhysicalKey(kVK_ANSI_5),
    GHOSTTY_KEY_DIGIT_6: PhysicalKey(kVK_ANSI_6),
    GHOSTTY_KEY_DIGIT_7: PhysicalKey(kVK_ANSI_7),
    GHOSTTY_KEY_DIGIT_8: PhysicalKey(kVK_ANSI_8),
    GHOSTTY_KEY_DIGIT_9: PhysicalKey(kVK_ANSI_9),
    GHOSTTY_KEY_EQUAL: PhysicalKey(kVK_ANSI_Equal),
    GHOSTTY_KEY_INTL_BACKSLASH: PhysicalKey(kVK_ISO_Section),
    GHOSTTY_KEY_INTL_RO: PhysicalKey(kVK_JIS_Underscore),
    GHOSTTY_KEY_INTL_YEN: PhysicalKey(kVK_JIS_Yen),
    GHOSTTY_KEY_A: PhysicalKey(kVK_ANSI_A),
    GHOSTTY_KEY_B: PhysicalKey(kVK_ANSI_B),
    GHOSTTY_KEY_C: PhysicalKey(kVK_ANSI_C),
    GHOSTTY_KEY_D: PhysicalKey(kVK_ANSI_D),
    GHOSTTY_KEY_E: PhysicalKey(kVK_ANSI_E),
    GHOSTTY_KEY_F: PhysicalKey(kVK_ANSI_F),
    GHOSTTY_KEY_G: PhysicalKey(kVK_ANSI_G),
    GHOSTTY_KEY_H: PhysicalKey(kVK_ANSI_H),
    GHOSTTY_KEY_I: PhysicalKey(kVK_ANSI_I),
    GHOSTTY_KEY_J: PhysicalKey(kVK_ANSI_J),
    GHOSTTY_KEY_K: PhysicalKey(kVK_ANSI_K),
    GHOSTTY_KEY_L: PhysicalKey(kVK_ANSI_L),
    GHOSTTY_KEY_M: PhysicalKey(kVK_ANSI_M),
    GHOSTTY_KEY_N: PhysicalKey(kVK_ANSI_N),
    GHOSTTY_KEY_O: PhysicalKey(kVK_ANSI_O),
    GHOSTTY_KEY_P: PhysicalKey(kVK_ANSI_P),
    GHOSTTY_KEY_Q: PhysicalKey(kVK_ANSI_Q),
    GHOSTTY_KEY_R: PhysicalKey(kVK_ANSI_R),
    GHOSTTY_KEY_S: PhysicalKey(kVK_ANSI_S),
    GHOSTTY_KEY_T: PhysicalKey(kVK_ANSI_T),
    GHOSTTY_KEY_U: PhysicalKey(kVK_ANSI_U),
    GHOSTTY_KEY_V: PhysicalKey(kVK_ANSI_V),
    GHOSTTY_KEY_W: PhysicalKey(kVK_ANSI_W),
    GHOSTTY_KEY_X: PhysicalKey(kVK_ANSI_X),
    GHOSTTY_KEY_Y: PhysicalKey(kVK_ANSI_Y),
    GHOSTTY_KEY_Z: PhysicalKey(kVK_ANSI_Z),
    GHOSTTY_KEY_MINUS: PhysicalKey(kVK_ANSI_Minus),
    GHOSTTY_KEY_PERIOD: PhysicalKey(kVK_ANSI_Period),
    GHOSTTY_KEY_QUOTE: PhysicalKey(kVK_ANSI_Quote),
    GHOSTTY_KEY_SEMICOLON: PhysicalKey(kVK_ANSI_Semicolon),
    GHOSTTY_KEY_SLASH: PhysicalKey(kVK_ANSI_Slash),
    GHOSTTY_KEY_ARROW_UP: PhysicalKey(kVK_UpArrow, keyEquivalent: .upArrow),
    GHOSTTY_KEY_ARROW_DOWN: PhysicalKey(kVK_DownArrow, keyEquivalent: .downArrow),
    GHOSTTY_KEY_ARROW_LEFT: PhysicalKey(kVK_LeftArrow, keyEquivalent: .leftArrow),
    GHOSTTY_KEY_ARROW_RIGHT: PhysicalKey(kVK_RightArrow, keyEquivalent: .rightArrow),
    GHOSTTY_KEY_HOME: PhysicalKey(kVK_Home, keyEquivalent: .home),
    GHOSTTY_KEY_END: PhysicalKey(kVK_End, keyEquivalent: .end),
    GHOSTTY_KEY_DELETE: PhysicalKey(kVK_ForwardDelete, keyEquivalent: .deleteForward),
    GHOSTTY_KEY_PAGE_UP: PhysicalKey(kVK_PageUp, keyEquivalent: .pageUp),
    GHOSTTY_KEY_PAGE_DOWN: PhysicalKey(kVK_PageDown, keyEquivalent: .pageDown),
    GHOSTTY_KEY_ESCAPE: PhysicalKey(kVK_Escape, keyEquivalent: .escape),
    GHOSTTY_KEY_ENTER: PhysicalKey(kVK_Return, keyEquivalent: .return),
    GHOSTTY_KEY_TAB: PhysicalKey(kVK_Tab, keyEquivalent: .tab),
    GHOSTTY_KEY_BACKSPACE: PhysicalKey(kVK_Delete, keyEquivalent: .delete),
    GHOSTTY_KEY_SPACE: PhysicalKey(kVK_Space, keyEquivalent: .space),
  ]
}
