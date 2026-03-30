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
      "Auto"
    case .light:
      "Light"
    case .dark:
      "Dark"
    }
  }

  var imageName: String {
    switch self {
    case .system:
      "AppearanceAuto"
    case .light:
      "AppearanceLight"
    case .dark:
      "AppearanceDark"
    }
  }
}
