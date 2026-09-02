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
      try await app.waitForReadyPane(SupatermPaneTargetRequest(paneID: pane.id))

      let free = try licenseStatus(runner, app: app)
      #expect(free.mode == .free)

      for _ in free.openTabCount..<5 {
        try await createReadyTab(runner, app: app, spaceID: initial.id)
      }

      let blocked = try runFailedSP(
        ["tab", "new", "--in", initial.id.uuidString],
        runner: runner,
        app: app
      )
      #expect(blocked.stderr.contains("Free mode allows 5 open tabs."))

      let activated = try decodeSPJSON(
        SupatermLicenseStatusResult.self,
        from: try runSuccessfulSP(
          ["license", "activate"],
          runner: runner,
          app: app,
          stdin: Data("\(testLicenseKey)\n".utf8),
          timeout: licenseCommandTimeout
        )
      )
      #expect(activated.mode == .paid)
      #expect(activated.updatesThrough == "9999-12-31")

      try await createReadyTab(runner, app: app, spaceID: initial.id)

      let deactivated = try decodeSPJSON(
        SupatermLicenseStatusResult.self,
        from: try runSuccessfulSP(
          ["license", "deactivate"],
          runner: runner,
          app: app,
          timeout: licenseCommandTimeout
        )
      )
      #expect(deactivated.mode == .free)
      #expect(deactivated.openTabCount == 6)

      _ = try runFailedSP(
        ["tab", "new", "--in", initial.id.uuidString],
        runner: runner,
        app: app
      )
    }
  }
}

private let testLicenseKey =
  "SUPATERM-AAAAAAAAAAAAAAAAAAAAAAAAAA-AAAAAAAAAAAAAAAAAAAAAAAAAA"

private func licenseStatus(
  _ runner: SPBinaryRunner,
  app: SupatermE2EApp
) throws -> SupatermLicenseStatusResult {
  try decodeSPJSON(
    SupatermLicenseStatusResult.self,
    from: try runSuccessfulSP(
      ["license", "status"],
      runner: runner,
      app: app,
      timeout: licenseCommandTimeout
    )
  )
}

private func createReadyTab(
  _ runner: SPBinaryRunner,
  app: SupatermE2EApp,
  spaceID: UUID
) async throws {
  let result = try decodeSPJSON(
    SupatermNewTabResult.self,
    from: try runSuccessfulSP(
      ["tab", "new", "--in", spaceID.uuidString, "--"] + hermeticShellArguments,
      runner: runner,
      app: app
    )
  )
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: result.paneID))
}

private func runSuccessfulSP(
  _ arguments: [String],
  runner: SPBinaryRunner,
  app: SupatermE2EApp,
  stdin: Data? = nil,
  timeout: TimeInterval = 10
) throws -> SPBinaryResult {
  do {
    return try requireSuccessfulSPResult(
      try runner.run(
        targeting(arguments, app: app),
        stdin: stdin,
        timeout: timeout
      )
    )
  } catch {
    throw SupatermE2EError("sp \(arguments.joined(separator: " ")) failed: \(error)")
  }
}

private let licenseCommandTimeout = SupatermLicenseTiming.clientResponseTimeout + 5

private func runFailedSP(
  _ arguments: [String],
  runner: SPBinaryRunner,
  app: SupatermE2EApp
) throws -> SPBinaryResult {
  try requireFailedSPResult(
    try runner.run(targeting(arguments, app: app))
  )
}

private func targeting(_ arguments: [String], app: SupatermE2EApp) -> [String] {
  Array(arguments.prefix(2))
    + ["--socket", app.socketPath, "--json"]
    + arguments.dropFirst(2)
}
