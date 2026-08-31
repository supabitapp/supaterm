import Testing

@testable import supaterm

struct TerminalAgentLaunchOptionsTests {
  @Test(
    arguments: [
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd", "/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd=/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-C", "/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-C/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd", "agent"],
        expectedPath: "/tmp/shell/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-Cagent"],
        expectedPath: "/tmp/shell/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd", "/tmp/first", "-C/tmp/last"],
        expectedPath: "/tmp/last"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--", "--cd", "/tmp/spoof"],
        expectedPath: "/tmp/shell"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-C/tmp/real", "--", "--cd=/tmp/spoof"],
        expectedPath: "/tmp/real"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--config", "--cd=/tmp/spoof"],
        expectedPath: "/tmp/shell"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-c", "-C/tmp/spoof"],
        expectedPath: "/tmp/shell"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--config", "--cd=/tmp/spoof", "-C/tmp/real"],
        expectedPath: "/tmp/real"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-C/tmp/real", "--future-option", "--cd=/tmp/spoof"],
        expectedPath: "/tmp/real"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-C", "--", "--cd=/tmp/spoof"],
        expectedPath: "/tmp/shell"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["node", "/tmp/codex.js", "--cd", "/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-Cagent"],
        processWorkingDirectoryPath: nil,
        expectedPath: nil
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd=/tmp/agent"],
        processWorkingDirectoryPath: nil,
        expectedPath: "/tmp/agent"
      ),
    ]
  )
  private func codexWorkingDirectoryFollowsCommandLine(testCase: CodexWorkingDirectoryTestCase) {
    #expect(
      TerminalAgentLaunchOptions.codexWorkingDirectoryPath(
        processWorkingDirectoryPath: testCase.processWorkingDirectoryPath,
        commandLineArguments: testCase.arguments
      ) == testCase.expectedPath
    )
  }

  @Test(
    arguments: [
      CodexAppServerTestCase(
        arguments: ["codex", "app-server", "--stdio"],
        expected: true
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "-c", "features.hooks=true", "app-server"],
        expected: true
      ),
      CodexAppServerTestCase(
        arguments: ["node", "/tmp/codex.js", "app-server"],
        expected: true
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "--cd", "app-server"],
        expected: false
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "--model=app-server"],
        expected: false
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "--config", "app-server"],
        expected: false
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "--", "app-server"],
        expected: false
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "--future-option", "app-server"],
        expected: false
      ),
      CodexAppServerTestCase(
        arguments: ["codex", "explain app-server"],
        expected: false
      ),
    ]
  )
  private func codexAppServerUsesParsedSubcommand(testCase: CodexAppServerTestCase) {
    #expect(
      TerminalAgentLaunchOptions.codexAppServerRuns(
        commandLineArguments: testCase.arguments
      ) == testCase.expected
    )
  }

  @Test(
    arguments: [
      CodexForkParentTestCase(
        arguments: ["codex", "fork", "019c8ad3-4601-70d9-b980-311e16d7a44c"],
        expectedSessionID: "019c8ad3-4601-70d9-b980-311e16d7a44c"
      ),
      CodexForkParentTestCase(
        arguments: [
          "codex", "--no-alt-screen", "--cd", "/tmp/agent", "fork",
          "019c8ad3-4601-70d9-b980-311e16d7a44c",
        ],
        expectedSessionID: "019c8ad3-4601-70d9-b980-311e16d7a44c"
      ),
      CodexForkParentTestCase(
        arguments: [
          "node", "/tmp/codex.js", "-C/tmp/agent", "fork",
          "019C8AD3-4601-70D9-B980-311E16D7A44C", "Prompt",
        ],
        expectedSessionID: "019c8ad3-4601-70d9-b980-311e16d7a44c"
      ),
      CodexForkParentTestCase(
        arguments: [
          "codex", "fork", "019c8ad3-4601-70d9-b980-311e16d7a44c", "--", "Prompt",
        ],
        expectedSessionID: "019c8ad3-4601-70d9-b980-311e16d7a44c"
      ),
      CodexForkParentTestCase(
        arguments: ["codex", "resume", "parent-session"],
        expectedSessionID: nil
      ),
      CodexForkParentTestCase(
        arguments: ["codex", "fork", "parent-session"],
        expectedSessionID: nil
      ),
      CodexForkParentTestCase(
        arguments: ["codex", "fork"],
        expectedSessionID: nil
      ),
      CodexForkParentTestCase(
        arguments: ["codex", "fork", "--last"],
        expectedSessionID: nil
      ),
      CodexForkParentTestCase(
        arguments: ["codex", "--cd", "fork", "parent-session"],
        expectedSessionID: nil
      ),
      CodexForkParentTestCase(
        arguments: [
          "codex", "--", "fork", "019c8ad3-4601-70d9-b980-311e16d7a44c",
        ],
        expectedSessionID: nil
      ),
      CodexForkParentTestCase(
        arguments: ["codex", "--future-option", "fork", "parent-session"],
        expectedSessionID: nil
      ),
    ]
  )
  private func codexForkParentUsesParsedCommandLine(testCase: CodexForkParentTestCase) {
    #expect(
      TerminalAgentLaunchOptions.codexForkParentSessionID(
        commandLineArguments: testCase.arguments
      ) == testCase.expectedSessionID
    )
  }

  @Test
  func relativeCodexWorkingDirectoryUsesTerminalPathWhenProcPathIsUnreadable() {
    #expect(
      codexAgentHookWorkingDirectoryPath(
        processWorkingDirectoryPath: nil,
        commandLineArguments: ["codex", "--cd", "project"],
        terminalWorkingDirectoryPath: "/tmp/shell"
      ) == "/tmp/shell/project"
    )
  }
}

private struct CodexWorkingDirectoryTestCase: Sendable {
  let arguments: [String]
  let processWorkingDirectoryPath: String?
  let expectedPath: String?

  nonisolated init(
    arguments: [String],
    processWorkingDirectoryPath: String? = "/tmp/shell",
    expectedPath: String?
  ) {
    self.arguments = arguments
    self.processWorkingDirectoryPath = processWorkingDirectoryPath
    self.expectedPath = expectedPath
  }
}

private struct CodexAppServerTestCase: Sendable {
  let arguments: [String]
  let expected: Bool
}

private struct CodexForkParentTestCase: Sendable {
  let arguments: [String]
  let expectedSessionID: String?
}
