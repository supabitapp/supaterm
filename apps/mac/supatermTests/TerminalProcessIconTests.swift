import Darwin
import Testing

@testable import SupatermSupport
@testable import supaterm

nonisolated struct TerminalProcessIconTests {
  private static let processGroupID: pid_t = 400

  @Test
  func mapsExecutableNamesAndAliases() {
    #expect(TerminalProcessIcon.matching(executableName: "/bin/bash") == .bash)
    #expect(TerminalProcessIcon.matching(executableName: "nvim") == .neovim)
    #expect(TerminalProcessIcon.matching(executableName: "vi") == .vim)
    #expect(TerminalProcessIcon.matching(executableName: "hx") == .helix)
    #expect(TerminalProcessIcon.matching(executableName: "gh") == .github)
    #expect(TerminalProcessIcon.matching(executableName: "glab") == .gitlab)
    #expect(TerminalProcessIcon.matching(executableName: "python3.13") == .python)
    #expect(TerminalProcessIcon.matching(executableName: "cargo") == .rust)
    #expect(TerminalProcessIcon.matching(executableName: "unknown") == nil)
  }

  @Test
  func matchesTheDeepestKnownProcessInTheForegroundGroup() throws {
    let bash = Self.process(400, parentProcessID: 1, name: "bash")
    let btop = Self.process(401, parentProcessID: 400, name: "btop")
    let background = Self.process(500, parentProcessID: 1, processGroupID: 500, name: "nvim")
    let match = try #require(
      TerminalProcessIconRecognizer.matches(
        foregroundProcessGroupIDs: [Self.processGroupID],
        table: ProcessTable(entries: [bash, btop, background]),
        invocation: { processID in
          switch processID {
          case 400: Self.invocation("/bin/bash")
          case 401: Self.invocation("/opt/homebrew/bin/btop")
          case 500: Self.invocation("/opt/homebrew/bin/nvim")
          default: nil
          }
        }
      )[Self.processGroupID]
    )

    #expect(match.icon == .btop)
    #expect(match.processIdentity == btop.identity)
  }

  @Test
  func fallsBackToTheProcessNameWhenArgumentsAreProtected() throws {
    let btop = Self.process(400, parentProcessID: 1, name: "btop")
    let match = try #require(
      TerminalProcessIconRecognizer.matches(
        foregroundProcessGroupIDs: [Self.processGroupID],
        table: ProcessTable(entries: [btop]),
        invocation: { _ in nil }
      )[Self.processGroupID]
    )

    #expect(match == TerminalProcessIconMatch(icon: .btop, processIdentity: btop.identity))
  }

  @Test
  @MainActor
  func loadsEveryBundledSVG() {
    #expect(
      TerminalProcessIcon.allCases.allSatisfy {
        TerminalProcessIconImageLoader.image(for: $0) != nil
      }
    )
  }

  private static func process(
    _ processID: pid_t,
    parentProcessID: pid_t,
    processGroupID: pid_t = processGroupID,
    name: String
  ) -> ProcessEntry {
    ProcessEntry(
      identity: TerminalAgentProcessIdentity(
        processID: processID,
        startTimeMicroseconds: UInt64(processID)
      ),
      parentProcessID: parentProcessID,
      processGroupID: processGroupID,
      name: name
    )
  }

  private static func invocation(_ executablePath: String) -> ProcessInvocation {
    ProcessInvocation(
      executablePath: executablePath,
      arguments: [executablePath],
      terminalType: nil
    )
  }
}
