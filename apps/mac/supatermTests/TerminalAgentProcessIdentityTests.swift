import Darwin
import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

struct TerminalAgentProcessIdentityTests {
  @Test
  func currentProcessIdentityMatchesCurrentProcess() throws {
    let processID = getpid()

    let identity = try #require(TerminalAgentProcessInspector.identity(for: processID))

    #expect(identity.processID == processID)
    #expect(identity.startTimeMicroseconds > 0)
    #expect(TerminalAgentProcessInspector.isCurrent(identity))
  }

  @Test
  func currentProcessWorkingDirectoryMatchesCurrentDirectory() throws {
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))

    #expect(
      TerminalAgentProcessInspector.workingDirectoryPath(for: identity)
        == FileManager.default.currentDirectoryPath
    )
  }

  @Test(
    arguments: [
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd", "/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-C", "agent"],
        expectedPath: "/tmp/shell/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd=/tmp/agent"],
        expectedPath: "/tmp/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "-Cagent"],
        expectedPath: "/tmp/shell/agent"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex", "--cd", "/tmp/first", "-C", "/tmp/last"],
        expectedPath: "/tmp/last"
      ),
      CodexWorkingDirectoryTestCase(
        arguments: ["codex"],
        expectedPath: "/tmp/shell"
      ),
    ]
  )
  func codexWorkingDirectoryFollowsCommandLine(testCase: CodexWorkingDirectoryTestCase) {
    #expect(
      TerminalAgentProcessInspector.codexWorkingDirectoryPath(
        processWorkingDirectoryPath: "/tmp/shell",
        commandLineArguments: testCase.arguments
      ) == testCase.expectedPath
    )
  }

  @Test
  func reusedProcessIDDoesNotMatchDifferentStartTime() throws {
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let reused = TerminalAgentProcessIdentity(
      processID: identity.processID,
      startTimeMicroseconds: identity.startTimeMicroseconds + 1
    )

    #expect(!TerminalAgentProcessInspector.isCurrent(reused))
  }

  @Test
  func readsAProcessOwnedByAnotherUser() throws {
    let identity = try #require(TerminalAgentProcessInspector.identity(for: 1))

    #expect(identity.processID == 1)
    #expect(TerminalAgentProcessInspector.isCurrent(identity))
  }

  @Test(arguments: [Int32.min, -1, 0])
  func nonpositiveProcessIDHasNoIdentity(processID: Int32) {
    #expect(TerminalAgentProcessInspector.identity(for: processID) == nil)
    #expect(TerminalAgentProcessInspector.foregroundProcessGroupID(for: processID) == nil)
  }
}

struct CodexWorkingDirectoryTestCase: Sendable {
  let arguments: [String]
  let expectedPath: String
}
