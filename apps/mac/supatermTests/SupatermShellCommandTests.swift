import SupatermCLIShared
import Testing

struct SupatermShellCommandTests {
  @Test
  func escapedTokenLeavesSafeTokensUnquoted() {
    #expect(SupatermShellCommand.escapedToken("abcXYZ09@%_+=:,./-") == "abcXYZ09@%_+=:,./-")
  }

  @Test
  func escapedTokenQuotesShellSensitiveText() {
    #expect(SupatermShellCommand.escapedToken("hello world") == "'hello world'")
    #expect(SupatermShellCommand.escapedToken("echo 'hi'") == #"'echo '"'"'hi'"'"''"#)
  }

  @Test
  func ghosttyStartupCommandRunsScriptThroughZsh() {
    #expect(SupatermShellCommand.ghosttyStartupCommand(for: "echo hello") == "/bin/zsh -lc 'echo hello'")
    #expect(
      SupatermShellCommand.ghosttyStartupCommand(for: "echo 1\necho 2")
        == "/bin/zsh -lc 'echo 1\necho 2'"
    )
  }
}
