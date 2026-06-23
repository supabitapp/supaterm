import Testing

@testable import SupatermCLIShared

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
  func ghosttyStartupCommandRunsScriptThroughLoginShell() {
    #expect(
      SupatermShellCommand.ghosttyStartupCommand(for: "echo hello", shellPath: "/bin/zsh")
        == "/bin/zsh -l -i -c 'echo hello'"
    )
    #expect(
      SupatermShellCommand.ghosttyStartupCommand(for: "echo hello", shellPath: "/opt/homebrew/bin/fish")
        == "/opt/homebrew/bin/fish -l -i -c 'echo hello'"
    )
    #expect(
      SupatermShellCommand.ghosttyStartupCommand(for: "echo 1\necho 2", shellPath: "/bin/zsh")
        == "/bin/zsh -l -i -c 'echo 1\necho 2'"
    )
  }

  @Test
  func ghosttyStartupCommandQuotesComplexScripts() {
    #expect(
      SupatermShellCommand.ghosttyStartupCommand(
        for: #"sp onboard; exec "${SHELL:-/bin/zsh}" -l"#,
        shellPath: "/bin/zsh"
      )
        == #"/bin/zsh -l -i -c 'sp onboard; exec "${SHELL:-/bin/zsh}" -l'"#
    )
  }

  @Test
  func interactiveStartupCommandLeavesZshBehind() {
    let expected =
      #"echo hello; shell="${SHELL:-/bin/zsh}"; [ -x "$shell" ] || shell="/bin/zsh"; "#
      + #"if "$shell" -l -c 'exit 0' >/dev/null 2>&1; then exec "$shell" -l; fi; exec "$shell""#

    #expect(
      SupatermShellCommand.interactiveStartupCommand(for: "echo hello", shellPath: "/bin/zsh")
        == expected
    )
  }

  @Test
  func interactiveStartupCommandLeavesFishBehind() {
    let expected =
      #"echo hello; set -l shell "$SHELL"; if test -z "$shell"; set shell /opt/homebrew/bin/fish; end; "#
      + #"if not test -x "$shell"; set shell /opt/homebrew/bin/fish; end; exec "$shell" -l"#

    #expect(
      SupatermShellCommand.interactiveStartupCommand(
        for: "echo hello",
        shellPath: "/opt/homebrew/bin/fish"
      )
        == expected
    )
  }

  @Test
  func loginShellPathPrefersCurrentUserShell() {
    #expect(
      SupatermShellCommand.loginShellPath(
        environment: ["SHELL": "/bin/zsh"],
        currentUserShellPath: "/opt/homebrew/bin/fish"
      ) == "/opt/homebrew/bin/fish"
    )
  }
}
