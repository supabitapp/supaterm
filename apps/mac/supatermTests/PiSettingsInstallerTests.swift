import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

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
      runPiCommand: { _, _ in
        PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hasSupatermPackageInstalledMatchesSSHSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writePiSettings(
      """
      {
        "packages": [
          "git:git@github.com:supabitapp/supaterm-skills.git"
        ]
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _, _ in
        PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
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
      runPiCommand: { _, _ in
        PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hasSupatermPackageInstalledMatchesLocalGitPathSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writePiSettings(
      """
      {
        "packages": [
          "../../code/github.com/supabitapp/supaterm-skills.git"
        ]
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _, _ in
        PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func installUsesCanonicalPackageSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments, timeout in
        capture.record(arguments, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
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
    #expect(capture.timeouts == [SupatermAgentHookManagementTiming.piMutationTimeout])
  }

  @Test
  func installUpdatesExistingCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings(
      #"{"packages":["git:github.com/supabitapp/supaterm-skills"]}"#,
      homeDirectoryURL: homeDirectoryURL
    )
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments, timeout in
        capture.record(arguments, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    try installer.installSupatermPackage()

    #expect(
      capture.commands == [
        PiSettingsInstaller.updateCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        )
      ]
    )
    #expect(capture.timeouts == [SupatermAgentHookManagementTiming.piMutationTimeout])
  }

  @Test
  func installIsIdempotentWithExistingCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings(
      #"{"packages":["git:github.com/supabitapp/supaterm-skills"]}"#,
      homeDirectoryURL: homeDirectoryURL
    )
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments, _ in
        capture.record(arguments)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )
    let settingsURL = PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)

    try installer.installSupatermPackage()
    let firstInstall = try Data(contentsOf: settingsURL)
    try installer.installSupatermPackage()
    let secondInstall = try Data(contentsOf: settingsURL)

    #expect(secondInstall == firstInstall)
    #expect(
      capture.commands == [
        PiSettingsInstaller.updateCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        ),
        PiSettingsInstaller.updateCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        ),
      ]
    )
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func installRemovesDuplicateCanonicalPackageSources() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings(
      #"{"packages":["git:github.com/supabitapp/supaterm-skills","git:github.com/supabitapp/supaterm-skills"]}"#,
      homeDirectoryURL: homeDirectoryURL
    )
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments, _ in
        capture.record(arguments)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    try installer.installSupatermPackage()

    #expect(
      capture.commands == [
        PiSettingsInstaller.removeCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        ),
        PiSettingsInstaller.installCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        ),
      ]
    )
  }

  @Test
  func installReplacesNoncanonicalPackageSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let oldSource = "git:git@github.com:supabitapp/supaterm-skills.git"
    try writePiSettings(
      "{\"packages\":[\"\(oldSource)\"]}",
      homeDirectoryURL: homeDirectoryURL
    )
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments, _ in
        capture.record(arguments)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    try installer.installSupatermPackage()

    #expect(
      capture.commands == [
        PiSettingsInstaller.removeCommandArguments(source: oldSource),
        PiSettingsInstaller.installCommandArguments(
          source: PiSettingsInstaller.canonicalPackageSource
        ),
      ]
    )
  }

  @Test
  func installRejectsTooManyMutationsBeforeRunningCommands() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sources = [
      "git:git@github.com:supabitapp/supaterm-skills.git",
      "https://github.com/supabitapp/supaterm-skills",
      "ssh://git@github.com/supabitapp/supaterm-skills.git",
    ]
    try writePiPackageSources(sources, homeDirectoryURL: homeDirectoryURL)
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: {
        Issue.record("Preflight must run before checking Pi availability.")
        return true
      },
      runPiCommand: { arguments, timeout in
        capture.record(arguments, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(throws: PiSettingsInstallerError.tooManyPackageSources) {
      try installer.installSupatermPackage()
    }

    #expect(capture.commands.isEmpty)
  }

  @Test
  func integrationHealthRequiresCurrentCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings(
      #"{"packages":["git:github.com/supabitapp/supaterm-skills"]}"#,
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _, _ in PiSettingsInstaller.CommandResult(status: 0) }
    )

    try writeInstalledPiPackage(version: "0.1.0", homeDirectoryURL: homeDirectoryURL)
    #expect(try installer.integrationHealth() == .drifted)

    try writeInstalledPiPackage(version: "0.2.0", homeDirectoryURL: homeDirectoryURL)
    #expect(try installer.integrationHealth() == .healthy)
  }

  @Test
  func integrationHealthAcceptsLocalDevelopmentPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings(
      #"{"packages":["../../code/supaterm/integrations/supaterm-skills"]}"#,
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { _, _ in
        Issue.record("Local development packages must not invoke Pi during health checks.")
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(try installer.integrationHealth() == .healthy)
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
          "git:github.com/supabitapp/supaterm-skills",
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
      runPiCommand: { arguments, timeout in
        capture.record(arguments, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
      }
    )

    try installer.removeSupatermPackage()

    #expect(
      capture.commands == [
        PiSettingsInstaller.removeCommandArguments(source: "../../code/github.com/supabitapp/supaterm-skills"),
        PiSettingsInstaller.removeCommandArguments(source: "git:github.com/supabitapp/supaterm-skills"),
      ]
    )
    #expect(
      capture.timeouts
        == Array(
          repeating: SupatermAgentHookManagementTiming.piMutationTimeout,
          count: 2
        )
    )
  }

  @Test
  func removeRejectsTooManyMutationsBeforeRunningCommands() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sources = [
      "git:git@github.com:supabitapp/supaterm-skills.git",
      "https://github.com/supabitapp/supaterm-skills",
      "ssh://git@github.com/supabitapp/supaterm-skills.git",
      "../../code/github.com/supabitapp/supaterm-skills",
    ]
    try writePiPackageSources(sources, homeDirectoryURL: homeDirectoryURL)
    let capture = PiCommandCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiCommand: { arguments, timeout in
        capture.record(arguments, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(throws: PiSettingsInstallerError.tooManyPackageSources) {
      try installer.removeSupatermPackage()
    }

    #expect(capture.commands.isEmpty)
  }

  @Test
  func hookManagementTimeoutsCoverPiMutationsAndChecks() {
    #expect(SupatermAgentHookManagementTiming.piAvailabilityTimeout == 10)
    #expect(SupatermAgentHookManagementTiming.piMutationTimeout == 60)
    #expect(SupatermAgentHookManagementTiming.maxPiMutationsPerRequest == 3)
    #expect(SupatermAgentHookManagementTiming.serverReplyTimeout == 240)
    #expect(SupatermAgentHookManagementTiming.clientResponseTimeout == 245)
  }

  @Test
  func removeEditsAllSettingsWhenPiIsUnavailable() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings(
      """
      {
        "packages": [
          {
            "source": "git:github.com/supabitapp/supaterm-skills",
            "extensions": ["extensions/pi-notify-supaterm"]
          },
          "git:git@github.com:supabitapp/supaterm-skills.git",
          "https://github.com/supabitapp/supaterm-skills",
          "../../code/github.com/supabitapp/supaterm-skills",
          "git:github.com/example/other-package"
        ],
        "theme": "dark"
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { false },
      runPiCommand: { _, _ in
        Issue.record("Removal must not invoke unavailable Pi.")
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    try installer.removeSupatermPackage()

    let settings = try piSettingsObject(homeDirectoryURL: homeDirectoryURL)
    #expect(settings["packages"] as? [String] == ["git:github.com/example/other-package"])
    #expect(settings["theme"] as? String == "dark")
    #expect(try installer.integrationHealth() == .unavailable)
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
      runPiCommand: { _, _ in
        PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
      }
    )

    #expect(try !installer.hasSupatermPackageInstalled())
  }

  @Test
  func installFailsWhenPiIsUnavailable() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { false },
      runPiCommand: { _, _ in
        Issue.record("runPiCommand should not be called when Pi is unavailable.")
        return PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
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
      runPiCommand: { _, _ in
        PiSettingsInstaller.CommandResult(status: 0, standardOutput: "", standardError: "")
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

private func writePiPackageSources(
  _ sources: [String],
  homeDirectoryURL: URL
) throws {
  let data = try JSONSerialization.data(withJSONObject: ["packages": sources])
  let contents = try #require(String(bytes: data, encoding: .utf8))
  try writePiSettings(contents, homeDirectoryURL: homeDirectoryURL)
}

private func writeInstalledPiPackage(
  version: String,
  homeDirectoryURL: URL
) throws {
  let packageURL =
    homeDirectoryURL
    .appendingPathComponent(".pi/agent/git/github.com/supabitapp/supaterm-skills/package.json")
  try FileManager.default.createDirectory(
    at: packageURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data("{\"version\":\"\(version)\"}".utf8).write(to: packageURL)
}

private func piSettingsObject(homeDirectoryURL: URL) throws -> [String: Any] {
  let data = try Data(contentsOf: PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL))
  return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

nonisolated final class PiCommandCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var value: [[String]] = []
  private var timeoutValue: [TimeInterval] = []

  func record(_ arguments: [String], timeout: TimeInterval? = nil) {
    lock.lock()
    value.append(arguments)
    if let timeout {
      timeoutValue.append(timeout)
    }
    lock.unlock()
  }

  var commands: [[String]] {
    lock.lock()
    let commands = value
    lock.unlock()
    return commands
  }

  var timeouts: [TimeInterval] {
    lock.lock()
    let timeouts = timeoutValue
    lock.unlock()
    return timeouts
  }
}
