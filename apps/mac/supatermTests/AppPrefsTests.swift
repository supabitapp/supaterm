import Foundation
import SwiftUI
import Testing

@testable import supaterm

struct AppPrefsTests {
  @Test
  func defaultURLUsesSupatermConfigPath() {
    let url = AppPrefs.defaultURL(homeDirectoryPath: "/tmp/khoi")

    #expect(url.path == "/tmp/khoi/.config/supaterm/appprefs.json")
  }

  @Test
  func appearanceModeResolvesColorScheme() {
    #expect(AppearanceMode.system.colorScheme == nil)
    #expect(AppearanceMode.light.colorScheme == .light)
    #expect(AppearanceMode.dark.colorScheme == .dark)
  }
}
