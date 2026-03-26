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
}
