import SupaTheme
import SwiftUI

extension Palette {
  init(spaceThemeID: String, colorScheme: ColorScheme) {
    self.init(theme: .curated(id: spaceThemeID), colorScheme: colorScheme)
  }
}
