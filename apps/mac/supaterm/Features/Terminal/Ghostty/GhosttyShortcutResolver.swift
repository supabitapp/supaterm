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
      guard let keyCode = physicalKeyCodes[physical] else { return nil }
      physicalKeyCode = keyCode
      if let equivalent = keyToEquivalent[physical] {
        key = equivalent
      } else {
        guard
          let character = SupatermKeyboardLayout.character(
            for: keyCode,
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

  private static let physicalKeyCodes: [ghostty_input_key_e: UInt16] = [
    GHOSTTY_KEY_BACKQUOTE: UInt16(kVK_ANSI_Grave),
    GHOSTTY_KEY_BACKSLASH: UInt16(kVK_ANSI_Backslash),
    GHOSTTY_KEY_BRACKET_LEFT: UInt16(kVK_ANSI_LeftBracket),
    GHOSTTY_KEY_BRACKET_RIGHT: UInt16(kVK_ANSI_RightBracket),
    GHOSTTY_KEY_COMMA: UInt16(kVK_ANSI_Comma),
    GHOSTTY_KEY_DIGIT_0: UInt16(kVK_ANSI_0),
    GHOSTTY_KEY_DIGIT_1: UInt16(kVK_ANSI_1),
    GHOSTTY_KEY_DIGIT_2: UInt16(kVK_ANSI_2),
    GHOSTTY_KEY_DIGIT_3: UInt16(kVK_ANSI_3),
    GHOSTTY_KEY_DIGIT_4: UInt16(kVK_ANSI_4),
    GHOSTTY_KEY_DIGIT_5: UInt16(kVK_ANSI_5),
    GHOSTTY_KEY_DIGIT_6: UInt16(kVK_ANSI_6),
    GHOSTTY_KEY_DIGIT_7: UInt16(kVK_ANSI_7),
    GHOSTTY_KEY_DIGIT_8: UInt16(kVK_ANSI_8),
    GHOSTTY_KEY_DIGIT_9: UInt16(kVK_ANSI_9),
    GHOSTTY_KEY_EQUAL: UInt16(kVK_ANSI_Equal),
    GHOSTTY_KEY_INTL_BACKSLASH: UInt16(kVK_ISO_Section),
    GHOSTTY_KEY_INTL_RO: UInt16(kVK_JIS_Underscore),
    GHOSTTY_KEY_INTL_YEN: UInt16(kVK_JIS_Yen),
    GHOSTTY_KEY_A: UInt16(kVK_ANSI_A),
    GHOSTTY_KEY_B: UInt16(kVK_ANSI_B),
    GHOSTTY_KEY_C: UInt16(kVK_ANSI_C),
    GHOSTTY_KEY_D: UInt16(kVK_ANSI_D),
    GHOSTTY_KEY_E: UInt16(kVK_ANSI_E),
    GHOSTTY_KEY_F: UInt16(kVK_ANSI_F),
    GHOSTTY_KEY_G: UInt16(kVK_ANSI_G),
    GHOSTTY_KEY_H: UInt16(kVK_ANSI_H),
    GHOSTTY_KEY_I: UInt16(kVK_ANSI_I),
    GHOSTTY_KEY_J: UInt16(kVK_ANSI_J),
    GHOSTTY_KEY_K: UInt16(kVK_ANSI_K),
    GHOSTTY_KEY_L: UInt16(kVK_ANSI_L),
    GHOSTTY_KEY_M: UInt16(kVK_ANSI_M),
    GHOSTTY_KEY_N: UInt16(kVK_ANSI_N),
    GHOSTTY_KEY_O: UInt16(kVK_ANSI_O),
    GHOSTTY_KEY_P: UInt16(kVK_ANSI_P),
    GHOSTTY_KEY_Q: UInt16(kVK_ANSI_Q),
    GHOSTTY_KEY_R: UInt16(kVK_ANSI_R),
    GHOSTTY_KEY_S: UInt16(kVK_ANSI_S),
    GHOSTTY_KEY_T: UInt16(kVK_ANSI_T),
    GHOSTTY_KEY_U: UInt16(kVK_ANSI_U),
    GHOSTTY_KEY_V: UInt16(kVK_ANSI_V),
    GHOSTTY_KEY_W: UInt16(kVK_ANSI_W),
    GHOSTTY_KEY_X: UInt16(kVK_ANSI_X),
    GHOSTTY_KEY_Y: UInt16(kVK_ANSI_Y),
    GHOSTTY_KEY_Z: UInt16(kVK_ANSI_Z),
    GHOSTTY_KEY_MINUS: UInt16(kVK_ANSI_Minus),
    GHOSTTY_KEY_PERIOD: UInt16(kVK_ANSI_Period),
    GHOSTTY_KEY_QUOTE: UInt16(kVK_ANSI_Quote),
    GHOSTTY_KEY_SEMICOLON: UInt16(kVK_ANSI_Semicolon),
    GHOSTTY_KEY_SLASH: UInt16(kVK_ANSI_Slash),
    GHOSTTY_KEY_ARROW_UP: UInt16(kVK_UpArrow),
    GHOSTTY_KEY_ARROW_DOWN: UInt16(kVK_DownArrow),
    GHOSTTY_KEY_ARROW_LEFT: UInt16(kVK_LeftArrow),
    GHOSTTY_KEY_ARROW_RIGHT: UInt16(kVK_RightArrow),
    GHOSTTY_KEY_HOME: UInt16(kVK_Home),
    GHOSTTY_KEY_END: UInt16(kVK_End),
    GHOSTTY_KEY_DELETE: UInt16(kVK_ForwardDelete),
    GHOSTTY_KEY_PAGE_UP: UInt16(kVK_PageUp),
    GHOSTTY_KEY_PAGE_DOWN: UInt16(kVK_PageDown),
    GHOSTTY_KEY_ESCAPE: UInt16(kVK_Escape),
    GHOSTTY_KEY_ENTER: UInt16(kVK_Return),
    GHOSTTY_KEY_TAB: UInt16(kVK_Tab),
    GHOSTTY_KEY_BACKSPACE: UInt16(kVK_Delete),
    GHOSTTY_KEY_SPACE: UInt16(kVK_Space),
  ]

  private static let keyToEquivalent: [ghostty_input_key_e: KeyEquivalent] = [
    GHOSTTY_KEY_ARROW_UP: .upArrow,
    GHOSTTY_KEY_ARROW_DOWN: .downArrow,
    GHOSTTY_KEY_ARROW_LEFT: .leftArrow,
    GHOSTTY_KEY_ARROW_RIGHT: .rightArrow,
    GHOSTTY_KEY_HOME: .home,
    GHOSTTY_KEY_END: .end,
    GHOSTTY_KEY_DELETE: .deleteForward,
    GHOSTTY_KEY_PAGE_UP: .pageUp,
    GHOSTTY_KEY_PAGE_DOWN: .pageDown,
    GHOSTTY_KEY_ESCAPE: .escape,
    GHOSTTY_KEY_ENTER: .return,
    GHOSTTY_KEY_TAB: .tab,
    GHOSTTY_KEY_BACKSPACE: .delete,
    GHOSTTY_KEY_SPACE: .space,
  ]
}
