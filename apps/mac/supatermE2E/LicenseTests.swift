import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct LicenseTests {
    @Test(.timeLimit(.minutes(5)))
    func activationUnlocksTabCreationThroughTheBundledCLI() async throws {
      let app = try await SupatermE2EApp.launch(
        environment: ["SUPATERM_LICENSE_MODE": "free"]
      )
      defer { app.terminate() }

      try await app.waitForDebugSnapshot("the initial tab is available") { snapshot in
        snapshot.windows.first?.spaces.first?.flattenedTabs.first?.panes.first != nil
      }
      let initial = try #require(app.debugSnapshot().windows.first?.spaces.first)
      let tab = try #require(initial.flattenedTabs.first)
      let pane = try #require(tab.panes.first)
      let runner = SPBinaryRunner(app: app, tabID: tab.id, paneID: pane.id)

      let free = try licenseStatus(runner)
      #expect(free.mode == .free)

      for _ in free.openTabCount..<5 {
        _ = try requireSuccessfulSPResult(
          try runner.run(["tab", "new", "--in", initial.id.uuidString, "--json"])
        )
      }

      let blocked = try requireFailedSPResult(
        try runner.run(["tab", "new", "--in", initial.id.uuidString, "--json"])
      )
      #expect(blocked.stderr.contains("sp license activate"))

      let activated = try decodeSPJSON(
        SupatermLicenseStatusResult.self,
        from: try requireSuccessfulSPResult(
          try runner.run(
            ["license", "activate", "--json"],
            stdin: Data("\(testLicenseKey)\n".utf8)
          )
        )
      )
      #expect(activated.mode == .paid)
      #expect(activated.updatesThrough == "9999-12-31")

      _ = try requireSuccessfulSPResult(
        try runner.run(["tab", "new", "--in", initial.id.uuidString, "--json"])
      )

      let deactivated = try decodeSPJSON(
        SupatermLicenseStatusResult.self,
        from: try requireSuccessfulSPResult(
          try runner.run(["license", "deactivate", "--json"])
        )
      )
      #expect(deactivated.mode == .free)
      #expect(deactivated.openTabCount == 6)

      _ = try requireFailedSPResult(
        try runner.run(["tab", "new", "--in", initial.id.uuidString, "--json"])
      )
    }
  }
}

private let testLicenseKey =
  "SUPATERM-AAAAAAAAAAAAAAAAAAAAAAAAAA-AAAAAAAAAAAAAAAAAAAAAAAAAA"

private func licenseStatus(_ runner: SPBinaryRunner) throws -> SupatermLicenseStatusResult {
  try decodeSPJSON(
    SupatermLicenseStatusResult.self,
    from: try requireSuccessfulSPResult(try runner.run(["license", "status", "--json"]))
  )
}
