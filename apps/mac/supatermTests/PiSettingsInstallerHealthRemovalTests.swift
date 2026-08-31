import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

struct PiSettingsInstallerHealthRemovalTests {
  @Test
  func integrationHealthRequiresCurrentCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiMutation: { _, _ in PiSettingsInstaller.CommandResult(status: 0) }
    )

    try writeInstalledPiPackage(version: "0.1.0", homeDirectoryURL: homeDirectoryURL)
    #expect(try installer.integrationHealth() == .drifted)

    try writeInstalledPiPackage(version: "0.2.0", homeDirectoryURL: homeDirectoryURL)
    #expect(try installer.integrationHealth() == .healthy)
  }

  @Test
  func integrationHealthAndSetupAcceptLocalDevelopmentPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      ["../../code/supaterm/integrations/supaterm-skills"],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiMutation: { _, _ in
        Issue.record("Local development packages must not invoke Pi.")
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(try installer.integrationHealth() == .healthy)
    #expect(try installer.setup() == .healthy)
  }

  @Test
  func removeUsesMatchedInstalledSources() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let relativeLocalValue = "../../code/github.com/supabitapp/supaterm-skills"
    let absoluteLocalValue =
      homeDirectoryURL.appendingPathComponent("code/github.com/supabitapp/supaterm-skills").path
    try writePiPackageSources(
      [
        relativeLocalValue,
        absoluteLocalValue,
        PiSettingsInstaller.canonicalPackageSource,
        PiSettingsInstaller.canonicalPackageSource,
      ],
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
    let relativeLocalSource = piPackageSource(
      relativeLocalValue,
      homeDirectoryURL: homeDirectoryURL
    )
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    try installer.removeSupatermPackage()

    #expect(
      capture.commands == [
        PiPackageMutationExecutor.commandArguments(for: .remove(relativeLocalSource)),
        PiPackageMutationExecutor.commandArguments(for: .remove(canonicalSource)),
      ]
    )
    #expect(
      capture.timeouts
        == Array(repeating: SupatermAgentIntegrationTiming.mutationTimeout, count: 2)
    )
  }

  @Test
  func removeUsesAbsoluteLexicalPathForSettingsRelativeLocalSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let settingsDirectory =
      PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
      .deletingLastPathComponent()
    let packageRoot = homeDirectoryURL.appendingPathComponent("package-root", isDirectory: true)
    let symlink = settingsDirectory.appendingPathComponent("package-link", isDirectory: true)
    let sourceValue = "package-link/supaterm-skills"
    try writePiPackageSources([sourceValue], homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: packageRoot.appendingPathComponent("supaterm-skills", isDirectory: true),
      withIntermediateDirectories: true
    )
    try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: packageRoot)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let source = piPackageSource(sourceValue, homeDirectoryURL: homeDirectoryURL)
    let absoluteSource =
      settingsDirectory
      .appendingPathComponent(sourceValue, isDirectory: true)
      .standardizedFileURL.path

    try installer.removeSupatermPackage()

    #expect(runner.mutations == [.remove(source)])
    #expect(source.mutationValue == absoluteSource)
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String] == []
    )
  }

  @Test
  func rollbackInstallUsesAbsolutePathForSettingsRelativeLocalSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sourceValue = "packages/supaterm-skills"
    let source = piPackageSource(sourceValue, homeDirectoryURL: homeDirectoryURL)
    let rollback = try #require(PiPackageMutation.remove(source).rollback)
    let absoluteSource =
      PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
      .deletingLastPathComponent()
      .appendingPathComponent(sourceValue, isDirectory: true)
      .standardizedFileURL.path

    #expect(
      PiPackageMutationExecutor.commandArguments(for: rollback)
        == LoginShellCommandAvailability.interactiveCommandArguments(
          for: "pi install '\(absoluteSource)'"
        )
    )
  }

  @Test
  func removeHostedShorthandMutatesSettings() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sourceValue = "git:github:supabitapp/supaterm-skills"
    try writePiPackageSources([sourceValue], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let source = piPackageSource(sourceValue, homeDirectoryURL: homeDirectoryURL)

    try installer.removeSupatermPackage()

    #expect(runner.mutations == [.remove(source)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String] == []
    )
  }

  @Test
  func removeCanonicalRefUsesExactInstalledSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sourceValue = "git:github.com/supabitapp/supaterm-skills#main"
    try writePiPackageSources([sourceValue], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let source = piPackageSource(sourceValue, homeDirectoryURL: homeDirectoryURL)

    try installer.removeSupatermPackage()

    #expect(runner.mutations == [.remove(source)])
    #expect(source.mutationValue == sourceValue)
    #expect(
      PiPackageMutationExecutor.commandArguments(for: .remove(source))
        == LoginShellCommandAvailability.interactiveCommandArguments(
          for: "pi remove '\(sourceValue)'"
        )
    )
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String] == []
    )
  }

  @Test
  func removeRestoresEarlierSourceWhenLaterRemovalFails() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let officialValue = "git:github.com/supabitapp/supaterm-skills"
    let forkValue = "git:github.com/example/supaterm-skills"
    try writePiPackageSources([officialValue, forkValue], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(
      homeDirectoryURL: homeDirectoryURL,
      failedMutationIndex: 2
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let officialSource = piPackageSource(officialValue, homeDirectoryURL: homeDirectoryURL)
    let forkSource = piPackageSource(forkValue, homeDirectoryURL: homeDirectoryURL)

    #expect(throws: PiSettingsInstallerError.removeFailed("failed")) {
      try installer.removeSupatermPackage()
    }
    #expect(
      runner.mutations == [
        .remove(officialSource),
        .remove(forkSource),
        .install(officialSource),
      ]
    )
    let packages = try #require(
      piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
    )
    #expect(Set(packages) == Set([officialValue, forkValue]))
  }

  @Test
  func removeRejectsTooManyMutationsBeforeRunningCommands() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sources = [
      homeDirectoryURL.appendingPathComponent("one/supaterm-skills").path,
      homeDirectoryURL.appendingPathComponent("two/supaterm-skills").path,
      homeDirectoryURL.appendingPathComponent("three/supaterm-skills").path,
      homeDirectoryURL.appendingPathComponent("four/supaterm-skills").path,
    ]
    try writePiPackageSources(sources, homeDirectoryURL: homeDirectoryURL)
    let capture = PiMutationCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiMutation: { mutation, timeout in
        capture.record(mutation, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(throws: PiSettingsInstallerError.tooManyPackageSources) {
      try installer.removeSupatermPackage()
    }
    #expect(capture.mutations.isEmpty)
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
      runPiMutation: { _, _ in
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
}
