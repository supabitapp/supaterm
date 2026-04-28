import AppKit
import GhosttyKit

private nonisolated func ghosttyUnshiftedCodepoint(for event: NSEvent) -> UInt32 {
  guard let chars = event.characters(byApplyingModifiers: []),
    let scalar = chars.unicodeScalars.first
  else { return 0 }
  return scalar.value
}

struct GhosttyGlobalKeyEvent: Sendable {
  let keyCode: UInt16
  let modifierFlagsRawValue: UInt
  let unshiftedCodepoint: UInt32

  nonisolated init(_ event: NSEvent) {
    keyCode = event.keyCode
    modifierFlagsRawValue = event.modifierFlags.rawValue
    unshiftedCodepoint = ghosttyUnshiftedCodepoint(for: event)
  }

  nonisolated init?(cgEvent: CGEvent) {
    guard let event = NSEvent(cgEvent: cgEvent) else { return nil }
    self.init(event)
  }

  var modifierFlags: NSEvent.ModifierFlags {
    NSEvent.ModifierFlags(rawValue: modifierFlagsRawValue)
  }
}

enum GhosttyKeyEvent {
  static func make(
    _ event: NSEvent,
    action: ghostty_input_action_e,
    originalMods: NSEvent.ModifierFlags,
    translationMods: NSEvent.ModifierFlags,
    composing: Bool = false
  ) -> ghostty_input_key_s {
    let unshiftedCodepoint: UInt32
    if event.type == .keyDown || event.type == .keyUp {
      unshiftedCodepoint = ghosttyUnshiftedCodepoint(for: event)
    } else {
      unshiftedCodepoint = 0
    }
    return make(
      keyCode: event.keyCode,
      action: action,
      modifiers: (originalMods, translationMods),
      composing: composing,
      unshiftedCodepoint: unshiftedCodepoint
    )
  }

  static func make(
    _ event: GhosttyGlobalKeyEvent,
    action: ghostty_input_action_e
  ) -> ghostty_input_key_s {
    make(
      keyCode: event.keyCode,
      action: action,
      modifiers: (event.modifierFlags, event.modifierFlags),
      composing: false,
      unshiftedCodepoint: event.unshiftedCodepoint
    )
  }

  private static func make(
    keyCode: UInt16,
    action: ghostty_input_action_e,
    modifiers: (original: NSEvent.ModifierFlags, translation: NSEvent.ModifierFlags),
    composing: Bool,
    unshiftedCodepoint: UInt32
  ) -> ghostty_input_key_s {
    var keyEvent: ghostty_input_key_s = ghostty_input_key_s()
    keyEvent.action = action
    keyEvent.keycode = UInt32(keyCode)
    keyEvent.text = nil
    keyEvent.composing = composing
    keyEvent.mods = mods(modifiers.original)
    keyEvent.consumed_mods = mods(modifiers.translation.subtracting([.control, .command]))
    keyEvent.unshifted_codepoint = unshiftedCodepoint
    return keyEvent
  }

  static func characters(_ event: NSEvent) -> String? {
    guard let characters = event.characters else { return nil }
    if characters.count == 1,
      let scalar = characters.unicodeScalars.first
    {
      if scalar.value < 0x20 {
        return event.characters(byApplyingModifiers: event.modifierFlags.subtracting(.control))
      }
      if scalar.value >= 0xF700 && scalar.value <= 0xF8FF {
        return nil
      }
    }
    return characters
  }

  static func mods(_ flags: NSEvent.ModifierFlags) -> ghostty_input_mods_e {
    var mods: UInt32 = GHOSTTY_MODS_NONE.rawValue
    if flags.contains(.shift) { mods |= GHOSTTY_MODS_SHIFT.rawValue }
    if flags.contains(.control) { mods |= GHOSTTY_MODS_CTRL.rawValue }
    if flags.contains(.option) { mods |= GHOSTTY_MODS_ALT.rawValue }
    if flags.contains(.command) { mods |= GHOSTTY_MODS_SUPER.rawValue }
    if flags.contains(.capsLock) { mods |= GHOSTTY_MODS_CAPS.rawValue }
    let rawFlags = flags.rawValue
    if (rawFlags & UInt(NX_DEVICERSHIFTKEYMASK)) != 0 { mods |= GHOSTTY_MODS_SHIFT_RIGHT.rawValue }
    if (rawFlags & UInt(NX_DEVICERCTLKEYMASK)) != 0 { mods |= GHOSTTY_MODS_CTRL_RIGHT.rawValue }
    if (rawFlags & UInt(NX_DEVICERALTKEYMASK)) != 0 { mods |= GHOSTTY_MODS_ALT_RIGHT.rawValue }
    if (rawFlags & UInt(NX_DEVICERCMDKEYMASK)) != 0 { mods |= GHOSTTY_MODS_SUPER_RIGHT.rawValue }
    return ghostty_input_mods_e(mods)
  }

  static func appKitMods(_ mods: ghostty_input_mods_e) -> NSEvent.ModifierFlags {
    var flags: NSEvent.ModifierFlags = []
    if (mods.rawValue & GHOSTTY_MODS_SHIFT.rawValue) != 0 { flags.insert(.shift) }
    if (mods.rawValue & GHOSTTY_MODS_CTRL.rawValue) != 0 { flags.insert(.control) }
    if (mods.rawValue & GHOSTTY_MODS_ALT.rawValue) != 0 { flags.insert(.option) }
    if (mods.rawValue & GHOSTTY_MODS_SUPER.rawValue) != 0 { flags.insert(.command) }
    if (mods.rawValue & GHOSTTY_MODS_CAPS.rawValue) != 0 { flags.insert(.capsLock) }
    return flags
  }
}
