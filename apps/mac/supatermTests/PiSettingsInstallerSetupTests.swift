import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

struct PiSettingsInstallerSetupTests {
  @Test
  func installUsesCanonicalPackageSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let capture = PiCommandCapture()
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)
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
        PiPackageMutationExecutor.commandArguments(for: .install(canonicalSource))
      ]
    )
    #expect(capture.timeouts == [PiSettingsInstaller.mutationTimeout])
  }

  @Test
  func installUpdatesExistingCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource],
      homeDirectoryURL: homeDirectoryURL
    )
    let capture = PiCommandCapture()
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)
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
        PiPackageMutationExecutor.commandArguments(for: .update(canonicalSource))
      ]
    )
    #expect(capture.timeouts == [PiSettingsInstaller.mutationTimeout])
  }

  @Test
  func installIsIdempotentWithExistingCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource],
      homeDirectoryURL: homeDirectoryURL
    )
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let settingsURL = PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    try installer.installSupatermPackage()
    let firstInstall = try Data(contentsOf: settingsURL)
    try installer.installSupatermPackage()
    let secondInstall = try Data(contentsOf: settingsURL)

    #expect(secondInstall == firstInstall)
    #expect(runner.mutations == [.update(canonicalSource), .update(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func installRemovesDuplicateCanonicalPackageSources() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource, PiSettingsInstaller.canonicalPackageSource],
      homeDirectoryURL: homeDirectoryURL
    )
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    try installer.installSupatermPackage()

    #expect(runner.mutations == [.remove(canonicalSource), .install(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func installReplacesNoncanonicalPackageSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let oldValue = "git:git@github.com:supabitapp/supaterm-skills.git"
    try writePiPackageSources([oldValue], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let oldSource = piPackageSource(oldValue, homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    try installer.installSupatermPackage()

    #expect(runner.mutations == [.remove(oldSource), .install(canonicalSource)])
  }

  @Test
  func installRejectsTooManyMutationsBeforeRunningCommands() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let sources = [
      homeDirectoryURL.appendingPathComponent("one/supaterm-skills").path,
      homeDirectoryURL.appendingPathComponent("two/supaterm-skills").path,
      homeDirectoryURL.appendingPathComponent("three/supaterm-skills").path,
    ]
    try writePiPackageSources(sources, homeDirectoryURL: homeDirectoryURL)
    let capture = PiMutationCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: {
        Issue.record("Preflight must run before checking Pi availability.")
        return true
      },
      runPiMutation: { mutation, timeout in
        capture.record(mutation, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(throws: PiSettingsInstallerError.tooManyPackageSources) {
      try installer.installSupatermPackage()
    }
    #expect(capture.mutations.isEmpty)
  }

  @Test
  func setupReplacesCanonicalAndAliasWithOneRemoval() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let aliasValue = "https://github.com/supabitapp/supaterm-skills"
    let unrelated = "git:github.com/example/other-package"
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource, aliasValue, unrelated],
      homeDirectoryURL: homeDirectoryURL
    )
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.availabilityChecks == 1)
    #expect(runner.mutations == [.remove(canonicalSource), .install(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [unrelated, PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func setupReplacesRemoteAliasesWithOneRemoval() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let firstValue = "git:git@github.com:supabitapp/supaterm-skills.git"
    let secondValue = "ssh://git@github.com/supabitapp/supaterm-skills.git"
    let unrelated = "git:github.com/example/other-package"
    try writePiPackageSources(
      [firstValue, secondValue, unrelated],
      homeDirectoryURL: homeDirectoryURL
    )
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let firstSource = piPackageSource(firstValue, homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.availabilityChecks == 1)
    #expect(runner.mutations == [.remove(firstSource), .install(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [unrelated, PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func setupReplacesOfficialAliasAndFork() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let officialValue = "https://github.com/supabitapp/supaterm-skills"
    let forkValue = "git:github.com/example/supaterm-skills"
    let unrelated = "git:github.com/example/other-package"
    try writePiPackageSources(
      [officialValue, forkValue, unrelated],
      homeDirectoryURL: homeDirectoryURL
    )
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let officialSource = piPackageSource(officialValue, homeDirectoryURL: homeDirectoryURL)
    let forkSource = piPackageSource(forkValue, homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.availabilityChecks == 1)
    #expect(
      runner.mutations == [
        .remove(officialSource),
        .remove(forkSource),
        .install(canonicalSource),
      ]
    )
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [unrelated, PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func setupReplacesNpmPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let npmValue = "npm:@example/supaterm-skills@1.0.0"
    let unrelated = "npm:@example/other-package"
    try writePiPackageSources([npmValue, unrelated], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let npmSource = piPackageSource(npmValue, homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.availabilityChecks == 1)
    #expect(runner.mutations == [.remove(npmSource), .install(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [unrelated, PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func setupReplacesHostedShorthand() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let shorthandValue = "git:github:supabitapp/supaterm-skills"
    try writePiPackageSources([shorthandValue], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let shorthandSource = piPackageSource(shorthandValue, homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.mutations == [.remove(shorthandSource), .install(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func setupReplacesHostedShorthandRef() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let shorthandValue = "git:github:supabitapp/supaterm-skills#main"
    try writePiPackageSources([shorthandValue], homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let shorthandSource = piPackageSource(shorthandValue, homeDirectoryURL: homeDirectoryURL)
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.mutations == [.remove(shorthandSource), .install(canonicalSource)])
    #expect(
      try piSettingsObject(homeDirectoryURL: homeDirectoryURL)["packages"] as? [String]
        == [PiSettingsInstaller.canonicalPackageSource]
    )
  }

  @Test
  func setupMutatesOnlyOutdatedCanonicalPackage() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource],
      homeDirectoryURL: homeDirectoryURL
    )
    try writeInstalledPiPackage(version: "0.2.0", homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(homeDirectoryURL: homeDirectoryURL)
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.availabilityChecks == 1)
    #expect(runner.mutations.isEmpty)

    try writeInstalledPiPackage(version: "0.1.0", homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .healthy)
    #expect(runner.availabilityChecks == 2)
    #expect(runner.mutations == [.update(canonicalSource)])
  }

  @Test
  func setupDoesNotReadInvalidSettingsWhenPiIsUnavailable() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings("not json", homeDirectoryURL: homeDirectoryURL)
    let runner = PiPackageMutationRunner(
      homeDirectoryURL: homeDirectoryURL,
      isAvailable: false
    )
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: runner.checkAvailability,
      runPiMutation: runner.run
    )

    #expect(try installer.setup() == .unavailable)
    #expect(runner.availabilityChecks == 1)
    #expect(runner.mutations.isEmpty)
  }

  @Test
  func setupReportsPostPlanHealth() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources([], homeDirectoryURL: homeDirectoryURL)
    let capture = PiMutationCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { capture.recordAvailabilityCheck() },
      runPiMutation: { mutation, timeout in
        capture.record(mutation, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )
    let canonicalSource = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.setup() == .absent)
    #expect(capture.availabilityChecks == 1)
    #expect(capture.mutations == [.install(canonicalSource)])
  }

  @Test
  func setupPropagatesMutationFailure() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources([], homeDirectoryURL: homeDirectoryURL)
    let capture = PiMutationCapture()
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { capture.recordAvailabilityCheck() },
      runPiMutation: { mutation, timeout in
        capture.record(mutation, timeout: timeout)
        return PiSettingsInstaller.CommandResult(status: 1, standardError: "failed")
      }
    )

    #expect(throws: PiSettingsInstallerError.installFailed("failed")) {
      try installer.setup()
    }
    #expect(capture.availabilityChecks == 1)
    #expect(capture.mutations.count == 1)
  }

  @Test
  func installFailsWhenPiIsUnavailable() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { false },
      runPiMutation: { _, _ in
        Issue.record("Pi mutations must not run when Pi is unavailable.")
        return PiSettingsInstaller.CommandResult(status: 0)
      }
    )

    #expect(throws: PiSettingsInstallerError.piUnavailable) {
      try installer.installSupatermPackage()
    }
  }

  @Test
  func integrationTimeoutsCoverPiSetup() {
    #expect(PiSettingsInstaller.availabilityTimeout == 10)
    #expect(PiSettingsInstaller.mutationTimeout == 60)
    #expect(PiSettingsInstaller.maximumMutationsPerRequest == 3)
    #expect(
      PiSettingsInstaller.maximumSetupDuration
        == PiSettingsInstaller.availabilityTimeout
        + PiSettingsInstaller.mutationTimeout
        * TimeInterval(PiSettingsInstaller.maximumMutationsPerRequest)
    )
    #expect(
      PiSettingsInstaller.maximumSetupDuration
        < SupatermAgentIntegrationTiming.serverReplyTimeout
    )
  }
}
