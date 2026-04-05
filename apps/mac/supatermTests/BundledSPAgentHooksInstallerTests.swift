import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct BundledSPAgentHooksInstallerTests {
  @Test
  func installUsesBundledCLIPathAndAgentSubcommand() throws {
    let resourcesURL = URL(fileURLWithPath: "/tmp/Supaterm.app/Contents/Resources", isDirectory: true)
    let capture = InstallCommandCapture()
    let installer = BundledSPAgentHooksInstaller(
      resourcesURL: resourcesURL,
      isExecutableFile: { $0 == "/tmp/Supaterm.app/Contents/Resources/bin/sp" },
      runInstallCommand: { path, commandArguments in
        capture.record(path: path, arguments: commandArguments)
        return .init(status: 0, standardError: "")
      }
    )

    try installer.installSupatermHooks(for: .claude)

    let snapshot = capture.snapshot()
    #expect(snapshot.path == "/tmp/Supaterm.app/Contents/Resources/bin/sp")
    #expect(snapshot.arguments == ["agent", "install", "claude"])
  }

  @Test
  func installFailsWhenBundledCLIIsUnavailable() {
    let installer = BundledSPAgentHooksInstaller(
      resourcesURL: nil,
      runInstallCommand: { _, _ in
        Issue.record("runInstallCommand should not be called when the bundled CLI is unavailable.")
        return .init(status: 0, standardError: "")
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
      runInstallCommand: { _, _ in
        .init(status: 1, standardError: "Claude settings must be valid JSON before Supaterm can install hooks.")
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
  private let lock = NSLock()
  private var path: String?
  private var arguments: [String]?

  func record(path: String, arguments: [String]) {
    lock.lock()
    self.path = path
    self.arguments = arguments
    lock.unlock()
  }

  func snapshot() -> (path: String?, arguments: [String]?) {
    lock.lock()
    let snapshot = (path, arguments)
    lock.unlock()
    return snapshot
  }
}
