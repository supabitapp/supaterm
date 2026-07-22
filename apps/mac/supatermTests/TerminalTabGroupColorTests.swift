import SupatermCLIShared
import Testing

@testable import supaterm

struct TerminalTabGroupColorTests {
  @Test
  func terminalColorsMatchSocketColors() {
    for color in TerminalTabGroupColor.allCases {
      #expect(color.socketColor.rawValue == color.rawValue)
    }
  }

  @Test
  func socketColorsMatchTerminalColors() {
    for color in SupatermTabGroupColor.allCases {
      #expect(TerminalTabGroupColor(socketColor: color).rawValue == color.rawValue)
    }
  }
}
