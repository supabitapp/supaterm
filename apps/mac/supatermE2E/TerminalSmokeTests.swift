import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct TerminalSmokeTests {
    @Test(.timeLimit(.minutes(5)))
    func shellRoundTripAcrossTabAndSplit() async throws {
      try await withTestSpace { app, space in
        let outputMarker = "E2EOK\(space.token)"
        let typedMarker = "E2E''OK\(space.token)"
        let pane = space.pane

        try await app.waitForShellPrompt(pane)

        try app.type("echo \(typedMarker) > round-trip.txt; cat round-trip.txt", into: pane)
        try await app.waitForCapture(pane, contains: typedMarker)
        #expect(try !app.capture(pane).contains(outputMarker))

        try app.press(.enter, in: pane)
        let resultFile = space.directory.appendingPathComponent("round-trip.txt")
        try await app.waitUntil("the shell writes round-trip.txt") {
          (try? String(contentsOf: resultFile, encoding: .utf8))?.contains(outputMarker) == true
        }
        try await app.waitForCapture(pane, contains: outputMarker)

        let split = try makeSplit(app, in: space)
        #expect(split.tabID == space.tab.tabID)
        #expect(split.paneID != space.tab.paneID)

        let splitPane = SupatermPaneTargetRequest(paneID: split.paneID)
        try await app.waitForShellPrompt(splitPane)
        try app.type("echo SPLIT''OK\(space.token) > split.txt\n", into: splitPane)
        let splitFile = space.directory.appendingPathComponent("split.txt")
        try await app.waitUntil("the split shell writes split.txt") {
          (try? String(contentsOf: splitFile, encoding: .utf8))?.contains("SPLITOK\(space.token)") == true
        }

        let snapshot = try app.debugSnapshot()
        let panes =
          snapshot.windows
          .flatMap(\.spaces)
          .flatMap(\.flattenedTabs)
          .first { $0.id == space.tab.tabID }?
          .panes ?? []
        #expect(Set(panes.map(\.id)) == [space.tab.paneID, split.paneID])
      }
    }
  }
}
