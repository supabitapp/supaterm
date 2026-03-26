import ArgumentParser
import Foundation
import Testing

@testable import SPCLI

struct SPCommandTests {
  @Test
  func newPaneHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp new-pane down --script"))
  }

  @Test
  func newTabHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewTab.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp new-tab --script"))
  }

  @Test(arguments: [
    ["new-pane", "right", "--script", "echo 1", "echo", "2"],
    ["new-tab", "--script", "echo 1", "echo", "2"],
  ])
  func parserRejectsScriptWithTrailingCommand(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject combining --script with a trailing command.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script cannot be used with a trailing command."))
    }
  }

  @Test
  func shellInputRejectsEmptyScript() {
    do {
      _ = try shellInput(script: "", tokens: [])
      Issue.record("Expected shellInput to reject an empty --script.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script must not be empty."))
    }
  }
}
