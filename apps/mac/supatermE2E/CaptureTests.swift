import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct CaptureTests {
    @Test(.timeLimit(.minutes(5)))
    func scrollbackKeepsScrolledOffOutputAndEndsWithVisible() async throws {
      try await withTestSpace { app, space in
        let prefix = "line-\(space.token)"
        try await app.waitForShellPrompt(space.pane)

        try app.type("for i in {1..300}; do echo \(prefix)-$i; done\n", into: space.pane)
        try await app.waitForCapture(space.pane, contains: "\(prefix)-300")

        let visible = try app.capture(space.pane)
        #expect(!visible.contains("\(prefix)-1\n"))

        let scrollback = try app.capture(space.pane, scope: .scrollback)
        #expect(scrollback.contains("\(prefix)-1\n"))

        let trimmedVisible = visible.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedScrollback = scrollback.trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(trimmedScrollback.hasSuffix(trimmedVisible))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func linesLimitReturnsSuffix() async throws {
      try await withTestSpace { app, space in
        let marker = "tail-\(space.token)"
        try await app.waitForShellPrompt(space.pane)

        try app.type("echo \(marker)\n", into: space.pane)
        try await app.waitForCapture(space.pane, contains: marker)

        let visible = try app.capture(space.pane)
        let visibleTail = try app.capture(space.pane, lines: 5)
        let expectedVisibleTail = visible.components(separatedBy: .newlines).suffix(5)
          .joined(separator: "\n")
        #expect(visibleTail == expectedVisibleTail)
        #expect(visibleTail.contains(marker))

        let scrollback = try app.capture(space.pane, scope: .scrollback)
        let scrollbackTail = try app.capture(space.pane, scope: .scrollback, lines: 5)
        let expectedScrollbackTail = scrollback.components(separatedBy: .newlines).suffix(5)
          .joined(separator: "\n")
        #expect(scrollbackTail == expectedScrollbackTail)
        #expect(scrollbackTail.contains(marker))
      }
    }
  }
}
