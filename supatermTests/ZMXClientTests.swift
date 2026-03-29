import Foundation
import Testing

@testable import supaterm

struct ZMXClientTests {
  private final class Recorder: @unchecked Sendable {
    nonisolated(unsafe) var arguments: [String]?
  }

  @Test
  func killSessionsDeduplicatesAndSortsSessionNames() {
    #expect(
      ZMXClient.sortedUniqueSessionNames(["sp.b", "sp.a", "sp.b"]) == ["sp.a", "sp.b"]
    )
  }

  @Test
  func killSessionBuildsBundledSPCommand() {
    let recorder = Recorder()

    ZMXClient.killSessionNamed("sp.test.session") { arguments in
      recorder.arguments = arguments
    }

    #expect(recorder.arguments == ["__kill-session", "--session", "sp.test.session"])
  }

  @Test
  func bundledSPURLUsesSiblingExecutablePath() {
    let executableURL = URL(fileURLWithPath: "/Applications/supaterm.app/Contents/MacOS/supaterm")

    #expect(
      ZMXClient.bundledSPURL(executableURL: executableURL)?
        .path(percentEncoded: false) == "/Applications/supaterm.app/Contents/MacOS/sp"
    )
  }
}
