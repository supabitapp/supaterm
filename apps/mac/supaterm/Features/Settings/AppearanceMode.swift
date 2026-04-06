import AppKit
import SupatermCLIShared
import SwiftUI

typealias AppearanceMode = SupatermCLIShared.AppearanceMode

extension AppearanceMode {
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
