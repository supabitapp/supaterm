import AppKit
import SupatermSettingsFeature
import Testing

@testable import supaterm

@MainActor
struct AppAppearanceTests {
  @Test
  func appliesEveryAppearanceModeToTheApplication() throws {
    let application = NSApplication.shared
    let originalAppearance = application.appearance
    let aqua = try #require(NSAppearance(named: .aqua))
    let darkAqua = try #require(NSAppearance(named: .darkAqua))
    defer {
      application.appearance = originalAppearance
    }

    for appearanceMode in AppearanceMode.allCases {
      application.appearance = appearanceMode == .dark ? aqua : darkAqua

      ApplicationAppearance.apply(appearanceMode)

      #expect(application.appearance?.name == appearanceMode.appearance?.name)
    }
  }
}
