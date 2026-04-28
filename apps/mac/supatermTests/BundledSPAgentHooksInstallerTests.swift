import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

struct BundledSPAgentHooksInstallerTests {
  @Test
  func installUsesBundledCLIPathAndAgentSubcommand() throws {
    let resourcesURL = URL(fileURLWithPath: "/tmp/Supaterm.app/Contents/Resources", isDirectory: true)
    let capture = InstallCommandCapture()
    let installer = BundledSPAgentHooksInstaller(
      resourcesURL: resourcesURL,
      isExecutableFile: { $0 == "/tmp/Supaterm.app/Contents/Resources/bin/sp" },
      environment: [
        "PATH": "/usr/bin:/bin",
        "SUPATERM_CLI_PATH": "/Applications/supaterm.app/Contents/Resources/bin/sp",
        "SUPATERM_SOCKET_PATH": "/tmp/socket",
        "SUPATERM_SURFACE_ID": UUID().uuidString,
        "SUPATERM_TAB_ID": UUID().uuidString,
      ],
      runInstallCommand: { path, commandArguments, environment in
        capture.record(path: path, arguments: commandArguments, environment: environment)
        return BundledSPAgentHooksInstaller.CommandResult(status: 0, standardError: "")
      }
    )

    try installer.installSupatermHooks(for: .claude)

    let snapshot = capture.snapshot()
    #expect(snapshot.path == "/tmp/Supaterm.app/Contents/Resources/bin/sp")
    #expect(snapshot.arguments == SupatermManagedHookCommand.installArguments(for: .claude))
    #expect(snapshot.environment == ["PATH": "/usr/bin:/bin"])
  }

  @Test
  func installFailsWhenBundledCLIIsUnavailable() {
    let installer = BundledSPAgentHooksInstaller(
      resourcesURL: nil,
      runInstallCommand: { _, _, _ in
        Issue.record("runInstallCommand should not be called when the bundled CLI is unavailable.")
        return BundledSPAgentHooksInstaller.CommandResult(status: 0, standardError: "")
      }
    )

    #expect(throws: BundledSPAgentHooksInstallerError.cliUnavailable) {
      try installer.installSupatermHooks(for: .claude)
    }
  }

  @Test
  func installSurfacesCommandFailure() {
    let installer = BundledSPAgentHooksInstaller(
      resourcesURL: URL(fileURLWithPath: "/tmp/Supaterm.app/Contents/Resources", isDirectory: true),
      isExecutableFile: { $0 == "/tmp/Supaterm.app/Contents/Resources/bin/sp" },
      runInstallCommand: { _, _, _ in
        BundledSPAgentHooksInstaller.CommandResult(
          status: 1,
          standardError: "Claude settings must be valid JSON before Supaterm can install hooks."
        )
      }
    )

    #expect(
      throws: BundledSPAgentHooksInstallerError.installFailed(
        .claude,
        "Claude settings must be valid JSON before Supaterm can install hooks."
      )
    ) {
      try installer.installSupatermHooks(for: .claude)
    }
  }
}

nonisolated final class InstallCommandCapture: @unchecked Sendable {
  struct Snapshot {
    let path: String?
    let arguments: [String]?
    let environment: [String: String]?
  }

  private let lock = NSLock()
  private var path: String?
  private var arguments: [String]?
  private var environment: [String: String]?

  func record(path: String, arguments: [String], environment: [String: String]) {
    lock.lock()
    self.path = path
    self.arguments = arguments
    self.environment = environment
    lock.unlock()
  }

  func snapshot() -> Snapshot {
    lock.lock()
    let snapshot = Snapshot(
      path: path,
      arguments: arguments,
      environment: environment
    )
    lock.unlock()
    return snapshot
  }
}
