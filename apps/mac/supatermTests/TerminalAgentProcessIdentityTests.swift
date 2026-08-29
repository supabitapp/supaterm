import Darwin
import Foundation
import Testing

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
