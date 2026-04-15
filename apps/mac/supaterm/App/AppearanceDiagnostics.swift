import AppKit
import OSLog
import SwiftUI

enum AppearanceDiagnostics {
  private static let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "app.supabit.supaterm",
    category: "appearance"
  )

  static func log(_ message: String) {
    logger.notice("\(message, privacy: .public)")
  }

  static func describe(_ appearanceMode: AppearanceMode) -> String {
    switch appearanceMode {
    case .system:
      "system"
    case .light:
      "light"
    case .dark:
      "dark"
    }
  }

  static func describe(_ colorScheme: ColorScheme) -> String {
    switch colorScheme {
    case .light:
      "light"
    case .dark:
      "dark"
    @unknown default:
      "unknown"
    }
  }

  static func describe(_ appearance: NSAppearance?) -> String {
    guard let appearance else { return "nil" }
    let name = appearance.name.rawValue
    let bestMatch = appearance.bestMatch(from: [.darkAqua, .aqua])?.rawValue ?? "unknown"
    return "\(name) bestMatch=\(bestMatch)"
  }

  static func describe(window: NSWindow?) -> String {
    guard let window else { return "nil" }
    let identifier = window.identifier?.rawValue ?? "nil"
    return [
      "id=\(identifier)",
      "number=\(window.windowNumber)",
      "appearance=\(describe(window.appearance))",
      "effective=\(describe(window.effectiveAppearance))",
      "key=\(window.isKeyWindow)",
      "visible=\(window.isVisible)",
    ].joined(separator: " ")
  }
}
