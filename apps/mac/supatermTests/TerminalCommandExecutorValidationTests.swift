import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalCommandExecutorValidationTests {
  @Test
  func validateReportsTheDefaultPathAsMissingWithoutASettingsFile() throws {
    let homeDirectoryURL = try temporarySettingsHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = commandExecutor.settingsValidate(
      SupatermSettingsValidateRequest(),
      validator: SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:])
    )

    #expect(
      result
        == SupatermSettingsValidationResult(
          path: SupatermStateRoot.settingsFileURL(
            homeDirectoryPath: homeDirectoryURL.path,
            environment: [:]
          ).path,
          status: .missing,
          warnings: [],
          errors: []
        )
    )
  }

  @Test
  func validateReportsUnknownKeysAsWarnings() throws {
    let homeDirectoryURL = try temporarySettingsHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let settingsURL = try writeSettings(
      """
      [appearance]
      mode = "light"

      [obsolete]
      key = true
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = commandExecutor.settingsValidate(
      SupatermSettingsValidateRequest(),
      validator: SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:])
    )

    #expect(
      result
        == SupatermSettingsValidationResult(
          path: settingsURL.path,
          status: .valid,
          warnings: ["Unknown config key `obsolete`."],
          errors: []
        )
    )
  }

  @Test
  func validateReportsAnExplicitMissingPathAsAnError() throws {
    let homeDirectoryURL = try temporarySettingsHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let missingURL = homeDirectoryURL.appendingPathComponent("missing.toml", isDirectory: false)
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = commandExecutor.settingsValidate(
      SupatermSettingsValidateRequest(path: missingURL.path),
      validator: SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:])
    )

    #expect(
      result
        == SupatermSettingsValidationResult(
          path: missingURL.path,
          status: .missing,
          warnings: [],
          errors: ["Config file not found at \(missingURL.path)."]
        )
    )
  }

  @Test
  func validateReportsUnreadableSettingsAsInvalid() throws {
    let homeDirectoryURL = try temporarySettingsHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let settingsURL = try writeSettings("appearance = [", homeDirectoryURL: homeDirectoryURL)
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = commandExecutor.settingsValidate(
      SupatermSettingsValidateRequest(path: settingsURL.path),
      validator: SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:])
    )

    #expect(result.path == settingsURL.path)
    #expect(result.status == .invalid)
    #expect(result.isFailure)
    #expect(!result.errors.isEmpty)
  }
}

private func temporarySettingsHome() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

@discardableResult
private func writeSettings(_ contents: String, homeDirectoryURL: URL) throws -> URL {
  let settingsURL = SupatermStateRoot.settingsFileURL(
    homeDirectoryPath: homeDirectoryURL.path,
    environment: [:]
  )
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data(contents.utf8).write(to: settingsURL)
  return settingsURL
}
