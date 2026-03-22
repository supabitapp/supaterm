import ArgumentParser
import Testing

@testable import SPCLI

struct SPHelpTests {
  @Test
  func rootHelpListsEnvironmentVariables() {
    let help = SP.helpMessage(for: SP.self, columns: 100)

    #expect(help.contains("Environment:"))
    #expect(help.contains("SUPATERM_SOCKET_PATH"))
    #expect(help.contains("SUPATERM_SURFACE_ID"))
    #expect(help.contains("SUPATERM_TAB_ID"))
  }

  @Test
  func newPaneHelpShowsSocketEnvironmentDefaultAndAmbientPaneTargeting() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--socket <socket>"))
    #expect(help.contains("default: $SUPATERM_SOCKET_PATH"))
    #expect(help.contains("If you omit --space and --tab inside Supaterm"))
    #expect(help.contains("SUPATERM_SURFACE_ID"))
    #expect(help.contains("SUPATERM_TAB_ID"))
    #expect(!help.contains("--space <space>                Target a space by its 1-based index. (default:"))
    #expect(
      !help.contains(
        "--tab <tab>                    Target a tab inside the specified space by its 1-based index. (default:"))
  }
}
