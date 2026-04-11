import Foundation
import Testing

@testable import SupatermCLIShared

struct PiSettingsInstallerTests {
  @Test
  func hasSupatermPackageInstalledMatchesCanonicalSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writePiSettings(
      """
      {
        "packages": [
          "git:github.com/supabitapp/supaterm-skills"
        ]
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _ in
        .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hasSupatermPackageInstalledMatchesLocalPathSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writePiSettings(
      """
      {
        "packages": [
          "../../code/github.com/supabitapp/supaterm-skills"
        ]
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _ in
        .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func installUsesCanonicalPackageSource() throws {
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      checkPiAvailable: { true },
      runPiCommand: { arguments in
        capture.record(arguments)
        return .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    try installer.installSupatermPackage()

    #expect(
      capture.commands == [
        PiSettingsInstaller.installCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        )
      ]
    )
  }

  @Test
  func canonicalInstallDisplayCommandUsesCanonicalPackageSource() {
    #expect(
      PiSettingsInstaller.canonicalInstallDisplayCommand
        == "pi install \(PiSettingsInstaller.canonicalPackageSource)"
    )
  }

  @Test
  func removeUsesMatchedInstalledSources() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writePiSettings(
      """
      {
        "packages": [
          "../../code/github.com/supabitapp/supaterm-skills",
          "git:github.com/supabitapp/supaterm-skills"
        ]
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments in
        capture.record(arguments)
        return .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    try installer.removeSupatermPackage()

    #expect(
      capture.commands == [
        PiSettingsInstaller.removeCommandArguments(source: "../../code/github.com/supabitapp/supaterm-skills"),
        PiSettingsInstaller.removeCommandArguments(source: "git:github.com/supabitapp/supaterm-skills"),
      ]
    )
  }

  @Test
  func hasSupatermPackageInstalledIgnoresLegacyRepoSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writePiSettings(
      """
      {
        "packages": [
          "git:github.com/supabitapp/supaterm"
        ]
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _ in
        .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try !installer.hasSupatermPackageInstalled())
  }

  @Test
  func installFailsWhenPiIsUnavailable() {
    let installer = PiSettingsInstaller(
      checkPiAvailable: { false },
      runPiCommand: { _ in
        Issue.record("runPiCommand should not be called when Pi is unavailable.")
        return .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(throws: PiSettingsInstallerError.piUnavailable) {
      try installer.installSupatermPackage()
    }
  }

  @Test
  func invalidSettingsSurfaceAReadableError() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let settingsURL = PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("not json".utf8).write(to: settingsURL)

    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _ in
        .init(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(throws: PiSettingsInstallerError.invalidSettings) {
      try installer.hasSupatermPackageInstalled()
    }
  }
}

private func temporaryPiHomeDirectory() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}

private func writePiSettings(
  _ contents: String,
  homeDirectoryURL: URL
) throws {
  let settingsURL = PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data(contents.utf8).write(to: settingsURL)
}

nonisolated final class PiCommandCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var value: [[String]] = []

  func record(_ arguments: [String]) {
    lock.lock()
    value.append(arguments)
    lock.unlock()
  }

  var commands: [[String]] {
    lock.lock()
    let commands = value
    lock.unlock()
    return commands
  }
}
