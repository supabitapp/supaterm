import AppKit
import SwiftUI

enum AppearanceMode: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
  case system
  case light
  case dark

  var id: String {
    rawValue
  }

  var colorScheme: ColorScheme? {
    switch self {
    case .system:
      nil
    case .light:
      .light
    case .dark:
      .dark
    }
  }

  var appearance: NSAppearance? {
    switch self {
    case .system:
      nil
    case .light:
      NSAppearance(named: .aqua)
    case .dark:
      NSAppearance(named: .darkAqua)
    }
  }

  var title: String {
    switch self {
    case .system:
      "System"
    case .light:
      "Light"
    case .dark:
      "Dark"
    }
  }

  var previewAccent: Color {
    Color(red: 0.09, green: 0.54, blue: 0.93)
  }

  var previewBackground: Color {
    switch self {
    case .system:
      Color(red: 0.13, green: 0.13, blue: 0.14)
    case .light:
      Color(red: 0.95, green: 0.95, blue: 0.95)
    case .dark:
      .black
    }
  }

  var previewPrimary: Color {
    switch self {
    case .system:
      Color.white.opacity(0.16)
    case .light:
      Color.black.opacity(0.14)
    case .dark:
      Color.white.opacity(0.2)
    }
  }

  var previewSecondary: Color {
    switch self {
    case .system:
      Color.white.opacity(0.12)
    case .light:
      Color.black.opacity(0.08)
    case .dark:
      Color.white.opacity(0.12)
    }
  }
}
