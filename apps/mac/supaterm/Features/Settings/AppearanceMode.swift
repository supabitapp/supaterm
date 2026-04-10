import AppKit
import SupatermCLIShared
import SwiftUI

public typealias AppearanceMode = SupatermCLIShared.AppearanceMode

extension AppearanceMode {
  public var colorScheme: ColorScheme? {
    switch self {
    case .system:
      nil
    case .light:
      .light
    case .dark:
      .dark
    }
  }

  public var appearance: NSAppearance? {
    switch self {
    case .system:
      nil
    case .light:
      NSAppearance(named: .aqua)
    case .dark:
      NSAppearance(named: .darkAqua)
    }
  }

  public var title: String {
    switch self {
    case .system:
      "Auto"
    case .light:
      "Light"
    case .dark:
      "Dark"
    }
  }

  public var imageName: String {
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
