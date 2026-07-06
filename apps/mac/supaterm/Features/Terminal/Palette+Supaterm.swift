import SupaTheme
import SupatermCLIShared
import SwiftUI

extension Palette {
  init(supatermSettings: SupatermSettings, colorScheme: ColorScheme) {
    self.init(theme: .curated(id: supatermSettings.themeID), colorScheme: colorScheme)
  }
}
