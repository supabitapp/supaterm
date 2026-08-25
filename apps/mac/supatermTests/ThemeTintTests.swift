import Foundation
import SupaTheme
import SupatermCLIShared
import Testing

@testable import supaterm

struct ThemeTintTests {
  @Test
  func tonesMapToReferenceAnchors() {
    let reference = ReferencePalette.default
    #expect(ThemeTint.neutral.tone(in: reference) == reference.neutral)
    #expect(ThemeTint.red.tone(in: reference) == reference.rose)
    #expect(ThemeTint.orange.tone(in: reference) == reference.clay)
    #expect(ThemeTint.yellow.tone(in: reference) == reference.gold)
    #expect(ThemeTint.green.tone(in: reference) == reference.green)
    #expect(ThemeTint.blue.tone(in: reference) == reference.blue)
    #expect(ThemeTint.pink.tone(in: reference) == reference.blush)
    #expect(ThemeTint.purple.tone(in: reference) == reference.violet)
  }

  @Test
  func projectJSONDecodesColor() throws {
    let json = Data(
      """
      {"id":{"rawValue":"6F1C6E4D-1E4C-4C33-9E8A-2B7F14D0A6B1"},
      "name":"Build","rootPath":null,"color":"blue","isPinned":false}
      """.utf8
    )
    let project = try JSONDecoder().decode(TerminalProject.self, from: json)
    #expect(project.color == .blue)
  }

  @Test
  func terminalColorsMatchSocketColors() {
    for color in ThemeTint.allCases {
      #expect(color.socketColor.rawValue == color.rawValue)
    }
  }

  @Test
  func socketColorsMatchTerminalColors() {
    for color in SupatermThemeColor.allCases {
      #expect(ThemeTint(socketColor: color).rawValue == color.rawValue)
    }
  }
}
