import SupaTheme
import SwiftUI

func previewBackgroundSeed(for colorScheme: ColorScheme) -> ThemeColor {
  colorScheme == .dark ? ThemeColor(hex: 0x1C1917) : ThemeColor(hex: 0xF0EDEC)
}
