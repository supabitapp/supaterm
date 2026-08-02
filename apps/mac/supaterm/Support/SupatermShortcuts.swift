import AppKit
import Carbon.HIToolbox
import Foundation
import SupatermCLIShared
import SwiftUI

public struct SupatermShortcutBinding: Hashable {
  public let keyCode: UInt16
  public let modifiers: SupatermShortcutOverride.Modifiers

  init(
    keyCode: UInt16,
    modifiers: SupatermShortcutOverride.Modifiers
  ) {
    self.keyCode = keyCode
    self.modifiers = modifiers
  }

  public init(_ override: SupatermShortcutOverride) {
    self.init(keyCode: override.keyCode, modifiers: override.modifiers)
  }

  public var keyboardShortcut: KeyboardShortcut {
    KeyboardShortcut(
      SupatermShortcutKey.keyEquivalent(for: keyCode),
      modifiers: modifiers.eventModifiers
    )
  }

  public var display: String {
    displaySymbols.joined()
  }

  public var displaySymbols: [String] {
    var symbols: [String] = []
    if modifiers.contains(.command) { symbols.append("⌘") }
    if modifiers.contains(.shift) { symbols.append("⇧") }
    if modifiers.contains(.option) { symbols.append("⌥") }
    if modifiers.contains(.control) { symbols.append("⌃") }
    symbols.append(SupatermShortcutKey.displayCharacter(for: keyCode))
    return symbols
  }
}

extension SupatermShortcutOverride.Modifiers {
  fileprivate var eventModifiers: SwiftUI.EventModifiers {
    var result: SwiftUI.EventModifiers = []
    if contains(.command) { result.insert(.command) }
    if contains(.option) { result.insert(.option) }
    if contains(.control) { result.insert(.control) }
    if contains(.shift) { result.insert(.shift) }
    return result
  }
}

public struct SupatermShortcut: Identifiable {
  public let id: SupatermShortcutID
  public let defaultBinding: SupatermShortcutBinding

  init(
    id: SupatermShortcutID,
    keyCode: UInt16,
    modifiers: SupatermShortcutOverride.Modifiers
  ) {
    self.id = id
    self.defaultBinding = SupatermShortcutBinding(keyCode: keyCode, modifiers: modifiers)
  }

  public var displayName: String {
    id.displayName
  }

  public func effective(
    from overrides: [SupatermShortcutID: SupatermShortcutOverride]
  ) -> SupatermShortcutBinding? {
    guard let override = overrides[id] else {
      return defaultBinding
    }
    guard override.isEnabled else {
      return nil
    }
    return SupatermShortcutBinding(override)
  }
}

public enum SupatermShortcutCategory: String, Sendable {
  case codingAgents
  case interface
  case spaces
  case tabs

  public var displayName: String {
    switch self {
    case .codingAgents:
      "Coding Agents"
    case .interface:
      "Interface"
    case .spaces:
      "Spaces"
    case .tabs:
      "Tabs"
    }
  }
}

public struct SupatermShortcutGroup: Identifiable {
  public let category: SupatermShortcutCategory
  public let shortcuts: [SupatermShortcut]

  public var id: String {
    category.rawValue
  }

  public init(
    category: SupatermShortcutCategory,
    shortcuts: [SupatermShortcut]
  ) {
    self.category = category
    self.shortcuts = shortcuts
  }
}

public enum SupatermShortcuts {
  public static let newTabInGroup = SupatermShortcut(
    id: .newTabInGroup,
    keyCode: UInt16(kVK_ANSI_T),
    modifiers: [.command, .option]
  )
  public static let toggleSidebar = SupatermShortcut(
    id: .toggleSidebar,
    keyCode: UInt16(kVK_ANSI_S),
    modifiers: .command
  )
  public static let toggleAgentPanel = SupatermShortcut(
    id: .toggleAgentPanel,
    keyCode: UInt16(kVK_ANSI_I),
    modifiers: .command
  )
  public static let jumpToLatestUnread = SupatermShortcut(
    id: .jumpToLatestUnread,
    keyCode: UInt16(kVK_ANSI_U),
    modifiers: [.command, .control]
  )
  public static let forkAgentSession = SupatermShortcut(
    id: .forkAgentSession,
    keyCode: UInt16(kVK_ANSI_F),
    modifiers: [.command, .option]
  )
  public static let copyAgentSessionID = SupatermShortcut(
    id: .copyAgentSessionID,
    keyCode: UInt16(kVK_ANSI_C),
    modifiers: [.command, .option]
  )

  public static let nextSpace = SupatermShortcut(
    id: .nextSpace,
    keyCode: UInt16(kVK_RightArrow),
    modifiers: [.command, .control]
  )
  public static let previousSpace = SupatermShortcut(
    id: .previousSpace,
    keyCode: UInt16(kVK_LeftArrow),
    modifiers: [.command, .control]
  )

  public static let selectSpaces = (1...10).map { index in
    SupatermShortcut(
      id: .selectSpace(index),
      keyCode: spaceKeyCode(index),
      modifiers: .control
    )
  }

  public static let groups = [
    SupatermShortcutGroup(
      category: .interface,
      shortcuts: [toggleSidebar, toggleAgentPanel, jumpToLatestUnread]
    ),
    SupatermShortcutGroup(
      category: .tabs,
      shortcuts: [newTabInGroup]
    ),
    SupatermShortcutGroup(
      category: .codingAgents,
      shortcuts: [forkAgentSession, copyAgentSessionID]
    ),
    SupatermShortcutGroup(
      category: .spaces,
      shortcuts: [nextSpace, previousSpace] + selectSpaces
    ),
  ]

  public static let all = groups.flatMap(\.shortcuts)

  private static func shortcut(for id: SupatermShortcutID) -> SupatermShortcut {
    guard let shortcut = all.first(where: { $0.id == id }) else {
      preconditionFailure("Unknown shortcut ID")
    }
    return shortcut
  }

  public static func binding(
    for id: SupatermShortcutID,
    overrides: [SupatermShortcutID: SupatermShortcutOverride]
  ) -> SupatermShortcutBinding? {
    shortcut(for: id).effective(from: overrides)
  }

  public static func conflict(
    for proposed: SupatermShortcutBinding,
    replacing id: SupatermShortcutID,
    overrides: [SupatermShortcutID: SupatermShortcutOverride],
    terminalDisplays: Set<String>
  ) -> String? {
    conflict(
      for: proposed,
      replacing: id,
      overrides: overrides,
      terminalDisplays: terminalDisplays,
      systemDisplays: SupatermShortcutKey.reservedDisplayStrings()
    )
  }

  public static func warnings(
    overrides: [SupatermShortcutID: SupatermShortcutOverride],
    terminalDisplays: Set<String>
  ) -> [SupatermShortcutID: String] {
    let systemDisplays = SupatermShortcutKey.reservedDisplayStrings()
    return Dictionary(
      uniqueKeysWithValues: all.compactMap { shortcut in
        guard let binding = shortcut.effective(from: overrides),
          let conflict = conflict(
            for: binding,
            replacing: shortcut.id,
            overrides: overrides,
            terminalDisplays: terminalDisplays,
            systemDisplays: systemDisplays
          )
        else {
          return nil
        }
        return (shortcut.id, "Conflicts with \(conflict).")
      })
  }

  private static func conflict(
    for proposed: SupatermShortcutBinding,
    replacing id: SupatermShortcutID,
    overrides: [SupatermShortcutID: SupatermShortcutOverride],
    terminalDisplays: Set<String>,
    systemDisplays: Set<String>
  ) -> String? {
    if systemDisplays.contains(proposed.display) {
      return "macOS"
    }
    if terminalDisplays.contains(proposed.display) {
      return "Terminal"
    }
    return all.first {
      $0.id != id && $0.effective(from: overrides)?.display == proposed.display
    }?.displayName
  }

  private static func spaceKeyCode(_ index: Int) -> UInt16 {
    switch index {
    case 1: UInt16(kVK_ANSI_1)
    case 2: UInt16(kVK_ANSI_2)
    case 3: UInt16(kVK_ANSI_3)
    case 4: UInt16(kVK_ANSI_4)
    case 5: UInt16(kVK_ANSI_5)
    case 6: UInt16(kVK_ANSI_6)
    case 7: UInt16(kVK_ANSI_7)
    case 8: UInt16(kVK_ANSI_8)
    case 9: UInt16(kVK_ANSI_9)
    case 10: UInt16(kVK_ANSI_0)
    default: preconditionFailure("Space shortcut index must be between 1 and 10")
    }
  }
}

private enum SupatermShortcutKey {
  static func keyEquivalent(for code: UInt16) -> KeyEquivalent {
    keyEquivalents[code] ?? KeyEquivalent(layoutCharacter(for: code)?.first ?? "?")
  }

  static func displayCharacter(for code: UInt16) -> String {
    displayCharacters[code]
      ?? layoutCharacter(for: code)?.uppercased()
      ?? String(format: "0x%02X", code)
  }

  static func reservedDisplayStrings() -> Set<String> {
    var result: Set<String> = ["⌘Q", "⌘W", "⌘H", "⌘M"]
    guard let defaults = UserDefaults(suiteName: "com.apple.symbolichotkeys"),
      let hotkeys = defaults.dictionary(forKey: "AppleSymbolicHotKeys")
    else {
      return result
    }

    for value in hotkeys.values {
      guard let entry = value as? [String: Any],
        entry["enabled"] as? Bool == true,
        let parameters = (entry["value"] as? [String: Any])?["parameters"] as? [Any],
        parameters.count >= 3,
        let keyCode = parameters[1] as? Int,
        let modifierFlags = parameters[2] as? Int
      else {
        continue
      }

      var modifiers: SupatermShortcutOverride.Modifiers = []
      if modifierFlags & 0x100 != 0 { modifiers.insert(.command) }
      if modifierFlags & 0x200 != 0 { modifiers.insert(.shift) }
      if modifierFlags & 0x800 != 0 { modifiers.insert(.option) }
      if modifierFlags & 0x1000 != 0 { modifiers.insert(.control) }
      result.insert(
        SupatermShortcutBinding(
          keyCode: UInt16(keyCode),
          modifiers: modifiers
        ).display
      )
    }
    return result
  }

  private static func layoutCharacter(for code: UInt16) -> String? {
    currentLayoutCharacter(for: code, modifierState: 0) ?? usQwertyFallback[code]
  }

  private static func currentLayoutCharacter(
    for code: UInt16,
    modifierState: UInt32
  ) -> String? {
    guard let layoutData = currentKeyboardLayoutData(),
      let bytes = CFDataGetBytePtr(layoutData)
    else {
      return nil
    }

    return bytes.withMemoryRebound(to: UCKeyboardLayout.self, capacity: 1) { keyboardLayout in
      var deadKeyState: UInt32 = 0
      var characters = [UniChar](repeating: 0, count: 4)
      var length = 0
      let status = UCKeyTranslate(
        keyboardLayout,
        code,
        UInt16(kUCKeyActionDisplay),
        modifierState,
        UInt32(LMGetKbdType()),
        UInt32(kUCKeyTranslateNoDeadKeysBit),
        &deadKeyState,
        characters.count,
        &length,
        &characters
      )
      guard status == noErr, length > 0 else {
        return nil
      }
      let result = String(utf16CodeUnits: characters, count: length)
      guard let scalar = result.unicodeScalars.first,
        scalar.value > 0x20,
        scalar.value != 0x7F
      else {
        return nil
      }
      return result
    }
  }

  private static func currentKeyboardLayoutData() -> CFData? {
    let sources = [
      TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
      TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
      TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue(),
    ].compactMap { $0 }

    for source in sources {
      guard
        let pointer = TISGetInputSourceProperty(
          source,
          kTISPropertyUnicodeKeyLayoutData
        )
      else {
        continue
      }
      let value = unsafeBitCast(pointer, to: CFTypeRef.self)
      guard CFGetTypeID(value) == CFDataGetTypeID() else {
        continue
      }
      return unsafeDowncast(value, to: CFData.self)
    }
    return nil
  }

  private static let keyEquivalents: [UInt16: KeyEquivalent] = [
    UInt16(kVK_LeftArrow): .leftArrow,
    UInt16(kVK_RightArrow): .rightArrow,
    UInt16(kVK_UpArrow): .upArrow,
    UInt16(kVK_DownArrow): .downArrow,
    UInt16(kVK_Return): .return,
    UInt16(kVK_Escape): .escape,
    UInt16(kVK_Delete): .delete,
    UInt16(kVK_Tab): .tab,
    UInt16(kVK_Space): .space,
    UInt16(kVK_Home): .home,
    UInt16(kVK_End): .end,
    UInt16(kVK_PageUp): .pageUp,
    UInt16(kVK_PageDown): .pageDown,
    UInt16(kVK_ForwardDelete): KeyEquivalent(Character(UnicodeScalar(NSDeleteFunctionKey)!)),
    UInt16(kVK_F1): KeyEquivalent(Character(UnicodeScalar(NSF1FunctionKey)!)),
    UInt16(kVK_F2): KeyEquivalent(Character(UnicodeScalar(NSF2FunctionKey)!)),
    UInt16(kVK_F3): KeyEquivalent(Character(UnicodeScalar(NSF3FunctionKey)!)),
    UInt16(kVK_F4): KeyEquivalent(Character(UnicodeScalar(NSF4FunctionKey)!)),
    UInt16(kVK_F5): KeyEquivalent(Character(UnicodeScalar(NSF5FunctionKey)!)),
    UInt16(kVK_F6): KeyEquivalent(Character(UnicodeScalar(NSF6FunctionKey)!)),
    UInt16(kVK_F7): KeyEquivalent(Character(UnicodeScalar(NSF7FunctionKey)!)),
    UInt16(kVK_F8): KeyEquivalent(Character(UnicodeScalar(NSF8FunctionKey)!)),
    UInt16(kVK_F9): KeyEquivalent(Character(UnicodeScalar(NSF9FunctionKey)!)),
    UInt16(kVK_F10): KeyEquivalent(Character(UnicodeScalar(NSF10FunctionKey)!)),
    UInt16(kVK_F11): KeyEquivalent(Character(UnicodeScalar(NSF11FunctionKey)!)),
    UInt16(kVK_F12): KeyEquivalent(Character(UnicodeScalar(NSF12FunctionKey)!)),
    UInt16(kVK_F13): KeyEquivalent(Character(UnicodeScalar(NSF13FunctionKey)!)),
    UInt16(kVK_F14): KeyEquivalent(Character(UnicodeScalar(NSF14FunctionKey)!)),
    UInt16(kVK_F15): KeyEquivalent(Character(UnicodeScalar(NSF15FunctionKey)!)),
    UInt16(kVK_F16): KeyEquivalent(Character(UnicodeScalar(NSF16FunctionKey)!)),
    UInt16(kVK_F17): KeyEquivalent(Character(UnicodeScalar(NSF17FunctionKey)!)),
    UInt16(kVK_F18): KeyEquivalent(Character(UnicodeScalar(NSF18FunctionKey)!)),
    UInt16(kVK_F19): KeyEquivalent(Character(UnicodeScalar(NSF19FunctionKey)!)),
    UInt16(kVK_F20): KeyEquivalent(Character(UnicodeScalar(NSF20FunctionKey)!)),
  ]

  private static let displayCharacters: [UInt16: String] = [
    UInt16(kVK_LeftArrow): "←",
    UInt16(kVK_RightArrow): "→",
    UInt16(kVK_UpArrow): "↑",
    UInt16(kVK_DownArrow): "↓",
    UInt16(kVK_Return): "↩",
    UInt16(kVK_Escape): "Esc",
    UInt16(kVK_Delete): "⌫",
    UInt16(kVK_Tab): "⇥",
    UInt16(kVK_Space): "Space",
    UInt16(kVK_Home): "↖",
    UInt16(kVK_End): "↘",
    UInt16(kVK_PageUp): "⇞",
    UInt16(kVK_PageDown): "⇟",
    UInt16(kVK_ForwardDelete): "⌦",
    UInt16(kVK_F1): "F1",
    UInt16(kVK_F2): "F2",
    UInt16(kVK_F3): "F3",
    UInt16(kVK_F4): "F4",
    UInt16(kVK_F5): "F5",
    UInt16(kVK_F6): "F6",
    UInt16(kVK_F7): "F7",
    UInt16(kVK_F8): "F8",
    UInt16(kVK_F9): "F9",
    UInt16(kVK_F10): "F10",
    UInt16(kVK_F11): "F11",
    UInt16(kVK_F12): "F12",
    UInt16(kVK_F13): "F13",
    UInt16(kVK_F14): "F14",
    UInt16(kVK_F15): "F15",
    UInt16(kVK_F16): "F16",
    UInt16(kVK_F17): "F17",
    UInt16(kVK_F18): "F18",
    UInt16(kVK_F19): "F19",
    UInt16(kVK_F20): "F20",
  ]

  private static let usQwertyFallback: [UInt16: String] = {
    let entries: [(Int, String)] = [
      (kVK_ANSI_A, "a"), (kVK_ANSI_B, "b"), (kVK_ANSI_C, "c"), (kVK_ANSI_D, "d"),
      (kVK_ANSI_E, "e"), (kVK_ANSI_F, "f"), (kVK_ANSI_G, "g"), (kVK_ANSI_H, "h"),
      (kVK_ANSI_I, "i"), (kVK_ANSI_J, "j"), (kVK_ANSI_K, "k"), (kVK_ANSI_L, "l"),
      (kVK_ANSI_M, "m"), (kVK_ANSI_N, "n"), (kVK_ANSI_O, "o"), (kVK_ANSI_P, "p"),
      (kVK_ANSI_Q, "q"), (kVK_ANSI_R, "r"), (kVK_ANSI_S, "s"), (kVK_ANSI_T, "t"),
      (kVK_ANSI_U, "u"), (kVK_ANSI_V, "v"), (kVK_ANSI_W, "w"), (kVK_ANSI_X, "x"),
      (kVK_ANSI_Y, "y"), (kVK_ANSI_Z, "z"),
      (kVK_ANSI_0, "0"), (kVK_ANSI_1, "1"), (kVK_ANSI_2, "2"), (kVK_ANSI_3, "3"),
      (kVK_ANSI_4, "4"), (kVK_ANSI_5, "5"), (kVK_ANSI_6, "6"), (kVK_ANSI_7, "7"),
      (kVK_ANSI_8, "8"), (kVK_ANSI_9, "9"),
      (kVK_ANSI_LeftBracket, "["), (kVK_ANSI_RightBracket, "]"),
      (kVK_ANSI_Comma, ","), (kVK_ANSI_Period, "."), (kVK_ANSI_Slash, "/"),
      (kVK_ANSI_Semicolon, ";"), (kVK_ANSI_Quote, "'"), (kVK_ANSI_Backslash, "\\"),
      (kVK_ANSI_Minus, "-"), (kVK_ANSI_Equal, "="), (kVK_ANSI_Grave, "`"),
    ]
    return Dictionary(uniqueKeysWithValues: entries.map { (UInt16($0.0), $0.1) })
  }()
}

extension View {
  @ViewBuilder
  public func supatermKeyboardShortcut(
    _ shortcut: KeyboardShortcut?
  ) -> some View {
    if let shortcut {
      keyboardShortcut(shortcut)
    } else {
      self
    }
  }
}
