import AppKit
import GhosttyKit
import SupatermCLIShared
import SwiftUI

extension GhosttyRuntime {
  private static let notificationAttentionPaletteIndexes = [4, 12]
  private static let minNotificationContrastRatio = 2.2
  private static let minNotificationSaturation = 0.12

  public func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    guard let config else { return nil }
    let trigger = ghostty_config_trigger(config, action, UInt(action.lengthOfBytes(using: .utf8)))
    return Self.keyboardShortcut(for: trigger)
  }

  public func commandPaletteEntries() -> [GhosttyCommand] {
    guard let config else { return [] }
    var value = ghostty_config_command_list_s()
    let key = "command-palette-entry"
    guard ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8))) else {
      return []
    }
    guard value.len > 0, let commands = value.commands else { return [] }
    let buffer = UnsafeBufferPointer(start: commands, count: Int(value.len))
    return buffer.map(GhosttyCommand.init(cValue:))
  }

  func shellIntegrationPlan(for shellCommand: String) -> GhosttyShellIntegrationPlan {
    guard let config else { return .empty }
    let rawPlan = ghostty_shell_integration_plan(config, shellCommand)
    defer {
      ghostty_shell_integration_plan_free(rawPlan)
    }
    guard rawPlan.applied else { return .empty }
    let plannedCommand: String?
    if rawPlan.command_changed, let command = rawPlan.command {
      plannedCommand = String(cString: command)
    } else {
      plannedCommand = nil
    }
    guard let envVars = rawPlan.env_vars, rawPlan.env_var_count > 0 else {
      return GhosttyShellIntegrationPlan(environmentVariables: [], plannedCommand: plannedCommand)
    }
    let buffer = UnsafeBufferPointer(start: envVars, count: Int(rawPlan.env_var_count))
    return GhosttyShellIntegrationPlan(
      environmentVariables: buffer.compactMap { envVar in
        guard let key = envVar.key, let value = envVar.value else { return nil }
        return SupatermCLIEnvironmentVariable(
          key: String(cString: key),
          value: String(cString: value)
        )
      },
      plannedCommand: plannedCommand
    )
  }

  func focusFollowsMouse() -> Bool {
    guard let config else { return false }
    var value = false
    let key = "focus-follows-mouse"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return value
  }

  func shouldShowScrollbar() -> Bool {
    guard let config else { return true }
    var valuePtr: UnsafePointer<CChar>?
    let key = "scrollbar"
    if ghostty_config_get(config, &valuePtr, key, UInt(key.lengthOfBytes(using: .utf8))),
      let ptr = valuePtr
    {
      return String(cString: ptr) != "never"
    }
    return true
  }

  public func splitPreserveZoomOnNavigation() -> Bool {
    guard let config else { return false }
    var value: CUnsignedInt = 0
    let key = "split-preserve-zoom"
    guard ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8))) else {
      return false
    }
    return value & (1 << 0) != 0
  }

  func backgroundOpacity() -> Double {
    guard let config else { return 1 }
    var value: Double = 1
    let key = "background-opacity"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return min(max(value, 0.001), 1)
  }

  func progressStyle() -> Bool {
    guard let config else { return true }
    var value = true
    let key = "progress-style"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return value
  }

  public func backgroundColor() -> NSColor {
    color(forKey: "background") ?? NSColor.windowBackgroundColor
  }

  public func splitDividerColor() -> NSColor {
    if let color = color(forKey: "split-divider-color") {
      return color
    }
    let background = backgroundColor()
    return background.darken(by: background.isLightColor ? 0.08 : 0.4)
  }

  public func unfocusedSplitDimmingColor() -> NSColor {
    color(forKey: "unfocused-split-fill") ?? backgroundColor()
  }

  public func unfocusedSplitDimmingOpacity() -> Double {
    guard let config else { return 0.3 }
    var value: Double = 0.7
    let key = "unfocused-split-opacity"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return 1 - min(max(value, 0.15), 1)
  }

  public func notificationAttentionColor() -> NSColor {
    let fallbackColor = color(forKey: "foreground") ?? .controlAccentColor
    guard
      let config,
      let background = color(forKey: "background")
    else {
      return fallbackColor
    }

    var palette = ghostty_config_palette_s()
    let key = "palette"
    guard ghostty_config_get(config, &palette, key, UInt(key.lengthOfBytes(using: .utf8))) else {
      return fallbackColor
    }

    let colors = withUnsafeBytes(of: palette) { buffer in
      Array(buffer.bindMemory(to: ghostty_config_color_s.self)).map { NSColor(ghostty: $0) }
    }

    return Self.notificationAttentionPaletteIndexes
      .compactMap { index -> NSColor? in
        guard colors.indices.contains(index) else { return nil }
        let color = colors[index]
        guard
          color.saturation >= Self.minNotificationSaturation,
          color.contrastRatio(with: background) >= Self.minNotificationContrastRatio
        else {
          return nil
        }
        return color
      }
      .max { lhs, rhs in
        lhs.relativeLuminance < rhs.relativeLuminance
      }
      ?? fallbackColor
  }

  public func chromeColorScheme() -> ColorScheme {
    backgroundColor().isLightColor ? .light : .dark
  }

  func scrollbarAppearanceName() -> NSAppearance.Name {
    backgroundColor().isLightColor ? .aqua : .darkAqua
  }

  private func color(forKey key: String) -> NSColor? {
    guard let config else { return nil }
    var color: ghostty_config_color_s = ghostty_config_color_s()
    if !ghostty_config_get(config, &color, key, UInt(key.lengthOfBytes(using: .utf8))) {
      return nil
    }
    return NSColor(ghostty: color)
  }

  private static func keyboardShortcut(for trigger: ghostty_input_trigger_s) -> KeyboardShortcut? {
    let key: KeyEquivalent
    switch trigger.tag {
    case GHOSTTY_TRIGGER_PHYSICAL:
      guard let equiv = keyToEquivalent[trigger.key.physical] else { return nil }
      key = equiv
    case GHOSTTY_TRIGGER_UNICODE:
      guard let scalar = UnicodeScalar(trigger.key.unicode) else { return nil }
      key = KeyEquivalent(Character(scalar))
    case GHOSTTY_TRIGGER_CATCH_ALL:
      return nil
    default:
      return nil
    }
    return KeyboardShortcut(key, modifiers: eventModifiers(mods: trigger.mods))
  }

  private static func eventModifiers(mods: ghostty_input_mods_e) -> EventModifiers {
    var flags: EventModifiers = []
    if mods.rawValue & GHOSTTY_MODS_SHIFT.rawValue != 0 { flags.insert(.shift) }
    if mods.rawValue & GHOSTTY_MODS_CTRL.rawValue != 0 { flags.insert(.control) }
    if mods.rawValue & GHOSTTY_MODS_ALT.rawValue != 0 { flags.insert(.option) }
    if mods.rawValue & GHOSTTY_MODS_SUPER.rawValue != 0 { flags.insert(.command) }
    return flags
  }

  private static let keyToEquivalent: [ghostty_input_key_e: KeyEquivalent] = [
    GHOSTTY_KEY_ARROW_UP: .upArrow,
    GHOSTTY_KEY_ARROW_DOWN: .downArrow,
    GHOSTTY_KEY_ARROW_LEFT: .leftArrow,
    GHOSTTY_KEY_ARROW_RIGHT: .rightArrow,
    GHOSTTY_KEY_HOME: .home,
    GHOSTTY_KEY_END: .end,
    GHOSTTY_KEY_DELETE: .delete,
    GHOSTTY_KEY_PAGE_UP: .pageUp,
    GHOSTTY_KEY_PAGE_DOWN: .pageDown,
    GHOSTTY_KEY_ESCAPE: .escape,
    GHOSTTY_KEY_ENTER: .return,
    GHOSTTY_KEY_TAB: .tab,
    GHOSTTY_KEY_BACKSPACE: .delete,
    GHOSTTY_KEY_SPACE: .space,
  ]
}

extension NSColor {
  fileprivate var isLightColor: Bool {
    luminance > 0.5
  }

  fileprivate var luminance: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let rgb = usingColorSpace(.sRGB) else { return 0 }
    rgb.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    return (0.299 * red) + (0.587 * green) + (0.114 * blue)
  }

  fileprivate var relativeLuminance: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let rgb = usingColorSpace(.sRGB) else { return 0 }
    rgb.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

    func channel(_ value: CGFloat) -> Double {
      let component = Double(value)
      if component <= 0.03928 {
        return component / 12.92
      }
      return pow((component + 0.055) / 1.055, 2.4)
    }

    return (0.2126 * channel(red)) + (0.7152 * channel(green)) + (0.0722 * channel(blue))
  }

  fileprivate var saturation: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let rgb = usingColorSpace(.sRGB) else { return 0 }
    rgb.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    let maximum = max(red, green, blue)
    let minimum = min(red, green, blue)
    guard maximum > 0 else { return 0 }
    return Double((maximum - minimum) / maximum)
  }

  fileprivate func contrastRatio(with other: NSColor) -> Double {
    let lighter = max(relativeLuminance, other.relativeLuminance)
    let darker = min(relativeLuminance, other.relativeLuminance)
    return (lighter + 0.05) / (darker + 0.05)
  }

  fileprivate func darken(by amount: CGFloat) -> NSColor {
    guard let rgb = usingColorSpace(.sRGB) else { return self }
    var hue: CGFloat = 0
    var saturation: CGFloat = 0
    var brightness: CGFloat = 0
    var alpha: CGFloat = 0
    rgb.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
    return NSColor(
      hue: hue,
      saturation: saturation,
      brightness: max(min(brightness * (1 - amount), 1), 0),
      alpha: alpha
    )
  }

  fileprivate convenience init(ghostty: ghostty_config_color_s) {
    let red = Double(ghostty.r) / 255
    let green = Double(ghostty.g) / 255
    let blue = Double(ghostty.b) / 255
    self.init(red: red, green: green, blue: blue, alpha: 1)
  }
}
