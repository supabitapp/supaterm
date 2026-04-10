import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated struct BundledSPAgentHooksInstaller {
  struct CommandResult: Equatable, Sendable {
    let status: Int32
    let standardError: String
  }

  let resourcesURL: URL?
  let isExecutableFile: @Sendable (String) -> Bool
  let environment: [String: String]
  let runInstallCommand:
    @Sendable (_ executablePath: String, _ arguments: [String], _ environment: [String: String]) throws ->
      CommandResult

  init(
    resourcesURL: URL? = Bundle.main.resourceURL,
    isExecutableFile: @escaping @Sendable (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
    environment: [String: String] = ProcessInfo.processInfo.environment,
    runInstallCommand:
      @escaping @Sendable (_ executablePath: String, _ arguments: [String], _ environment: [String: String]) throws
      -> CommandResult =
      Self.runInstallCommand
  ) {
    self.resourcesURL = resourcesURL
    self.isExecutableFile = isExecutableFile
    self.environment = environment
    self.runInstallCommand = runInstallCommand
  }

  func installSupatermHooks(for agent: SupatermAgentKind) throws {
    guard
      let cliPath = GhosttySupport.bundledCLIPath(resourcesURL: resourcesURL),
      isExecutableFile(cliPath)
    else {
      throw BundledSPAgentHooksInstallerError.cliUnavailable
    }

    let commandResult: CommandResult
    do {
      commandResult = try runInstallCommand(
        cliPath,
        SupatermManagedHookCommand.installArguments(for: agent),
        Self.sanitizedEnvironment(environment)
      )
    } catch let error as BundledSPAgentHooksInstallerError {
      throw error
    } catch {
      throw BundledSPAgentHooksInstallerError.installFailed(
        agent,
        error.localizedDescription
      )
    }

    guard commandResult.status == 0 else {
      throw BundledSPAgentHooksInstallerError.installFailed(
        agent,
        commandResult.standardError
      )
    }
  }

  static func runInstallCommand(
    executablePath: String,
    arguments: [String],
    environment: [String: String]
  ) throws -> CommandResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = arguments
    process.environment = environment

    let errorPipe = Pipe()
    process.standardError = errorPipe

    try process.run()
    process.waitUntilExit()

    let standardError =
      String(
        bytes: errorPipe.fileHandleForReading.readDataToEndOfFile(),
        encoding: .utf8
      ) ?? ""
    return .init(
      status: process.terminationStatus,
      standardError: standardError.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  static func sanitizedEnvironment(_ environment: [String: String]) -> [String: String] {
    environment.filter { !$0.key.hasPrefix("SUPATERM_") }
  }
}

nonisolated enum BundledSPAgentHooksInstallerError: Error, Equatable, LocalizedError {
  case cliUnavailable
  case installFailed(SupatermAgentKind, String)

  var errorDescription: String? {
    switch self {
    case .cliUnavailable:
      return "Supaterm's bundled sp CLI is unavailable."
    case .installFailed(let agent, let details):
      if details.isEmpty {
        return "Supaterm could not install \(agent.notificationTitle) hooks."
      }
      return details
    }
  }
}
